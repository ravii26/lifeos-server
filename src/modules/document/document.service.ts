import type { Document, Prisma } from "@prisma/client"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { findTopicById } from "../topic/topic.repository.js"
import { findNotebookById } from "../notebook/notebook.repository.js"
import { findAreasByUser, findAreaById } from "../area/area.repository.js"
import { createTask } from "../task/task.repository.js"
import { createHabit } from "../habit/habit.repository.js"
import { createGoal } from "../goal/goal.repository.js"
import { createLink, deleteLinksForEntity } from "../link/link.repository.js"
import { embedTexts, embeddingsAvailable } from "../../lib/embeddings.js"
import logger from "../../lib/logger.js"
import {
  createDocument,
  createChunks,
  findDocumentsByUser,
  findDocumentWithCount,
  findDocumentById,
  updateDocument,
  deleteDocument,
  createSuggestions,
  findSuggestionsByDocument,
  findSuggestionById,
  updateSuggestion,
  deletePendingSuggestions,
} from "./document.repository.js"
import { chunkDocument } from "../../lib/chunking.js"
import { runKnowledgeAsk } from "../knowledge/knowledge.ask.js"
import { extractActions } from "./document.extract.js"
import { getUserNow } from "../../lib/rag.js"
import type { DocumentDto, SuggestionDto } from "./document.dto.js"
import type { AskResultDto } from "../knowledge/knowledge.dto.js"
import type { AcceptSuggestionDto, ListDocumentsDto } from "./document.schema.js"

// Shape of the DocumentSuggestion.meta JSON column.
interface SuggestionMeta {
  suggestedAreaId?: string | null
  suggestedAreaName?: string | null
  frequency?: string | null
  targetMinutes?: number | null
  priority?: string | null
  dueDate?: string | null
}

// ---- helpers -------------------------------------------------------

type DocWithCount = Document & { _count?: { chunks: number } }

const toDto = (doc: DocWithCount): DocumentDto => ({
  id: doc.id,
  title: doc.title,
  sourceType: doc.sourceType,
  status: doc.status,
  chunkCount: doc._count?.chunks ?? 0,
  topicId: doc.topicId,
  notebookId: doc.notebookId,
  error: doc.error,
  createdAt: doc.createdAt,
})

const getOwnedDocument = async (id: string, userId: string): Promise<DocWithCount> => {
  const doc = await findDocumentWithCount(id, userId)
  if (!doc) throw new NotFoundError("Document not found")
  return doc
}

const assertTopicOwned = async (topicId: string, userId: string) => {
  if (!(await findTopicById(topicId, userId))) throw new NotFoundError("Topic not found")
}
const assertNotebookOwned = async (notebookId: string, userId: string) => {
  if (!(await findNotebookById(notebookId, userId))) throw new NotFoundError("Notebook not found")
}

// Derive a title from the first meaningful line when the user didn't supply one.
const deriveTitle = (text: string): string => {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstLine) return "Untitled document"
  return firstLine.replace(/^#{1,6}\s+/, "").slice(0, 200)
}

// ---- ingest (background) -------------------------------------------

// Chunk the raw text, embed each chunk, persist the chunks, then flip the
// document to READY. Runs in the background so create returns instantly (same
// pattern as capture classification). Any failure marks the document FAILED
// with a reason rather than leaving it stuck PENDING.
const ingest = async (documentId: string, userId: string, rawText: string): Promise<void> => {
  try {
    const chunks = chunkDocument(rawText)
    if (chunks.length === 0) {
      await updateDocument(documentId, userId, { status: "FAILED", error: "No text to index" })
      return
    }

    // Embeddings require Gemini. Without a key we still persist the chunks (so
    // keyword-based ask works) and mark the doc READY.
    let embeddings: number[][] = []
    if (embeddingsAvailable()) {
      embeddings = await embedTexts(chunks.map((c) => c.content))
    }

    const rows: Prisma.DocumentChunkUncheckedCreateInput[] = chunks.map((c, i) => ({
      userId,
      documentId,
      index: i,
      heading: c.heading ?? null,
      content: c.content,
      embedding: embeddings[i] ?? [],
    }))

    await createChunks(rows)
    await updateDocument(documentId, userId, { status: "READY", error: null })
    logBehavior(userId, "DOCUMENT_INGESTED", { documentId, chunks: rows.length })
  } catch (err) {
    logger.error("Document ingestion failed:", err)
    await updateDocument(documentId, userId, {
      status: "FAILED",
      error: err instanceof Error ? err.message : "Ingestion failed",
    }).catch(() => {
      // If even the status update fails there's nothing more we can do here.
    })
  }
}

// ---- create / read -------------------------------------------------

export interface CreateDocumentInput {
  title?: string
  text: string
  sourceType: "PASTED" | "UPLOADED"
  topicId?: string
  notebookId?: string
}

export const createDocumentService = async (
  userId: string,
  input: CreateDocumentInput,
): Promise<DocumentDto> => {
  const text = input.text.trim()
  if (!text) throw new ValidationError("Document text is empty")

  if (input.topicId) await assertTopicOwned(input.topicId, userId)
  if (input.notebookId) await assertNotebookOwned(input.notebookId, userId)

  const doc = await createDocument({
    userId,
    title: input.title?.trim() || deriveTitle(text),
    rawText: text,
    sourceType: input.sourceType,
    status: "PENDING",
    topicId: input.topicId ?? null,
    notebookId: input.notebookId ?? null,
  })

  // Chunk + embed in the background so the request returns immediately.
  void ingest(doc.id, userId, text).catch((err) => {
    logger.error("Background document ingestion crashed:", err)
  })

  return toDto(doc)
}

export const listDocumentsService = async (
  userId: string,
  filters: ListDocumentsDto,
): Promise<DocumentDto[]> => {
  const where = filters.status ? { status: filters.status } : {}
  const docs = await findDocumentsByUser(userId, where)
  return docs.map(toDto)
}

export const getDocumentService = async (id: string, userId: string): Promise<DocumentDto> => {
  const doc = await getOwnedDocument(id, userId)
  return toDto(doc)
}

export const deleteDocumentService = async (id: string, userId: string): Promise<void> => {
  await getOwnedDocument(id, userId)
  // Chunks + suggestions cascade-delete via their Document relation. Clean up
  // any EntityLinks pointing at this document so accepted Tasks/Habits/Goals
  // don't keep a dangling link to a ghost (the entities themselves stay).
  await deleteLinksForEntity(userId, "DOCUMENT", id)
  await deleteDocument(id, userId)
}

// ---- extract & suggestions (phase 2: Structure) --------------------

const toSuggestionDto = (s: {
  id: string
  documentId: string
  itemType: string
  title: string
  detail: string | null
  confidence: number
  status: string
  sourceHeading: string | null
  meta: Prisma.JsonValue
  createdEntityType: string | null
  createdEntityId: string | null
}): SuggestionDto => {
  const meta = (s.meta ?? {}) as SuggestionMeta
  return {
    id: s.id,
    documentId: s.documentId,
    itemType: s.itemType as SuggestionDto["itemType"],
    title: s.title,
    detail: s.detail,
    confidence: s.confidence,
    status: s.status as SuggestionDto["status"],
    sourceHeading: s.sourceHeading,
    suggestedAreaId: meta.suggestedAreaId ?? null,
    suggestedAreaName: meta.suggestedAreaName ?? null,
    frequency: meta.frequency ?? null,
    targetMinutes: meta.targetMinutes ?? null,
    priority: meta.priority ?? null,
    dueDate: meta.dueDate ?? null,
    createdEntity:
      s.createdEntityId && s.createdEntityType
        ? { type: s.createdEntityType, id: s.createdEntityId }
        : null,
  }
}

const assertAreaOwned = async (areaId: string, userId: string) => {
  if (!(await findAreaById(areaId, userId))) throw new NotFoundError("Area not found")
}

// Run the AI over a READY document, proposing actionable Habits/Goals/Tasks.
// Clears the previous un-acted-on batch first so re-extracting doesn't pile up.
export const extractDocumentService = async (
  documentId: string,
  userId: string,
): Promise<SuggestionDto[]> => {
  const doc = await findDocumentById(documentId, userId)
  if (!doc) throw new NotFoundError("Document not found")
  if (doc.status !== "READY") {
    throw new ValidationError("Document is still indexing — try again in a moment")
  }

  const areas = await findAreasByUser(userId)
  const now = await getUserNow(userId)
  const items = await extractActions(
    doc.rawText,
    areas.map((a) => ({ id: a.id, name: a.name })),
    now,
  )

  // Map each AI-suggested area name onto a real owned area id.
  const areaByName = new Map(areas.map((a) => [a.name.toLowerCase(), a]))

  await deletePendingSuggestions(userId, documentId)

  const rows: Prisma.DocumentSuggestionUncheckedCreateInput[] = items.map((it) => {
    const matched = it.suggestedAreaName
      ? areaByName.get(it.suggestedAreaName.toLowerCase())
      : undefined
    const meta: SuggestionMeta = {
      suggestedAreaId: matched?.id ?? null,
      suggestedAreaName: matched?.name ?? it.suggestedAreaName ?? null,
      frequency: it.frequency ?? null,
      targetMinutes: it.targetMinutes ?? null,
      priority: it.priority ?? null,
      dueDate: it.dueDate ?? null,
    }
    return {
      userId,
      documentId,
      itemType: it.itemType,
      title: it.title,
      detail: it.detail ?? null,
      confidence: it.confidence,
      sourceHeading: it.sourceHeading ?? null,
      meta: meta as Prisma.InputJsonValue,
      status: "PENDING",
    }
  })

  if (rows.length) await createSuggestions(rows)
  logBehavior(userId, "SUGGESTIONS_EXTRACTED", { documentId, count: rows.length })

  const saved = await findSuggestionsByDocument(userId, documentId, {
    status: { not: "DISMISSED" },
  })
  return saved.map(toSuggestionDto)
}

export const listSuggestionsService = async (
  documentId: string,
  userId: string,
): Promise<SuggestionDto[]> => {
  const doc = await findDocumentById(documentId, userId)
  if (!doc) throw new NotFoundError("Document not found")
  const rows = await findSuggestionsByDocument(userId, documentId, {
    status: { not: "DISMISSED" },
  })
  return rows.map(toSuggestionDto)
}

// Accept a proposal → create the real Task/Habit/Goal and link it back to the
// source document. Habits/Goals need an area (from the override or the AI's
// suggestion); tasks can go area-less. Goals are created PARKED so accepting a
// batch never blows past the active-goal focus cap.
export const acceptSuggestionService = async (
  suggestionId: string,
  userId: string,
  overrides: AcceptSuggestionDto,
): Promise<SuggestionDto> => {
  const s = await findSuggestionById(suggestionId, userId)
  if (!s) throw new NotFoundError("Suggestion not found")
  if (s.status !== "PENDING") throw new ValidationError("Suggestion already handled")

  const meta = (s.meta ?? {}) as SuggestionMeta
  const areaId = overrides.areaId ?? meta.suggestedAreaId ?? null
  if (areaId) await assertAreaOwned(areaId, userId)

  let createdType: "TASK" | "HABIT" | "GOAL"
  let createdId: string

  if (s.itemType === "TASK") {
    const task = await createTask({
      userId,
      areaId,
      title: s.title,
      priority: (overrides.priority ?? meta.priority ?? "MEDIUM") as never,
      status: "TODO",
      taskType: "BOOLEAN",
      dueDate: meta.dueDate ? new Date(meta.dueDate) : undefined,
    })
    createdType = "TASK"
    createdId = task.id
  } else if (s.itemType === "HABIT") {
    if (!areaId) throw new ValidationError("An area is required to create a habit")
    const habit = await createHabit({
      userId,
      areaId,
      title: s.title,
      habitType: "BOOLEAN",
      frequency: (meta.frequency ?? "DAILY") as never,
      targetMinutes: meta.targetMinutes ?? undefined,
    })
    createdType = "HABIT"
    createdId = habit.id
  } else {
    if (!areaId) throw new ValidationError("An area is required to create a goal")
    const goal = await createGoal({
      userId,
      areaId,
      title: s.title,
      description: s.detail ?? undefined,
      priority: (overrides.priority ?? meta.priority ?? "MEDIUM") as never,
      status: "PARKED",
    })
    createdType = "GOAL"
    createdId = goal.id
  }

  // Provenance link: created entity → source document. Best-effort; a link
  // hiccup shouldn't undo a successful entity creation.
  await createLink({
    userId,
    fromType: createdType,
    fromId: createdId,
    toType: "DOCUMENT",
    toId: s.documentId,
    role: "REFERENCES",
  }).catch((err) => logger.warn(`Suggestion accept: link creation failed: ${err}`))

  await updateSuggestion(suggestionId, userId, {
    status: "ACCEPTED",
    createdEntityType: createdType,
    createdEntityId: createdId,
  })

  const updated = await findSuggestionById(suggestionId, userId)
  return toSuggestionDto(updated!)
}

export const dismissSuggestionService = async (
  suggestionId: string,
  userId: string,
): Promise<void> => {
  const s = await findSuggestionById(suggestionId, userId)
  if (!s) throw new NotFoundError("Suggestion not found")
  await updateSuggestion(suggestionId, userId, { status: "DISMISSED" })
}

// ---- ask -----------------------------------------------------------

export const askDocumentService = async (
  userId: string,
  question: string,
  documentId?: string,
): Promise<AskResultDto> => {
  // When scoped to a document, make sure it's the user's before answering.
  if (documentId) {
    const doc = await findDocumentById(documentId, userId)
    if (!doc) throw new NotFoundError("Document not found")
  }

  const result = await runKnowledgeAsk(userId, question, documentId)
  logBehavior(userId, "QUESTION_ASKED", { documentId: documentId ?? null })
  return result
}
