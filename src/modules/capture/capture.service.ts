import type { MediaType, Prisma, WorthCheck } from "@prisma/client"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { findAreaById } from "../area/area.repository.js"
import { findTopicById } from "../topic/topic.repository.js"
import { createTask } from "../task/task.repository.js"
import { createHabit } from "../habit/habit.repository.js"
import { createNote } from "../note/note.repository.js"
import { createResource } from "../resource/resource.repository.js"
import { maybeCreateBacklogReminder } from "../task/backlog-reminder.service.js"
import { createVaultItem } from "../vault/vault.repository.js"
import { createLink } from "../link/link.repository.js"
import {
  createCapture,
  findCapturesByUser,
  countCapturesByUser,
  findCaptureById,
  updateCapture,
  deleteCapture,
} from "./capture.repository.js"
import { getPagination, paginatedResponse } from "../../shared/utils/pagination.util.js"
import {
  classifyCapture,
  classifyMediaCapture,
  type CaptureType,
  type Classification,
} from "./capture.ai.js"
import { getUserRagContext } from "../../lib/rag.js"
import { storage, extFromMime } from "../../lib/storage.js"
import logger from "../../lib/logger.js"
import type {
  UpdateCaptureDto,
  ConvertCaptureDto,
  ListCapturesDto,
} from "./capture.schema.js"
import type { CaptureDto } from "./capture.dto.js"

// ---- helpers -------------------------------------------------------

const getOwnedCapture = async (id: string, userId: string) => {
  const capture = await findCaptureById(id, userId)
  if (!capture) throw new NotFoundError("Capture not found")
  return capture
}

const mapWorthCheck = (val: string | null | undefined): WorthCheck => {
  if (!val) return "SAVE_LATER"
  const upper = val.toUpperCase()
  if (upper === "YES" || upper === "WORTH_NOW") return "WORTH_NOW"
  if (upper === "NO" || upper === "NOT_RELEVANT") return "NOT_RELEVANT"
  return "SAVE_LATER"
}

// Classification lives in the suggestedOutputs JSON column.
const readClassification = (
  capture: { suggestedOutputs: Prisma.JsonValue },
): { type: CaptureType; meta: Classification["meta"] } => {
  const raw = (capture.suggestedOutputs ?? {}) as {
    type?: CaptureType
    meta?: Classification["meta"]
  }
  return { type: raw.type ?? "TASK", meta: raw.meta ?? {} }
}

const toDto = (capture: {
  id: string
  rawText: string
  confidence: number | null
  status: string
  worthCheck: WorthCheck | null
  worthReason: string | null
  detectedUrl: string | null
  mediaType: MediaType
  mediaUrl: string | null
  suggestedOutputs: Prisma.JsonValue
  createdOutputs: Prisma.JsonValue
  createdAt: Date
}): CaptureDto => {
  const { type, meta } = readClassification(capture)
  return {
    id: capture.id,
    text: capture.rawText,
    type,
    confidence: capture.confidence,
    processed: capture.status !== "PENDING",
    status: capture.status,
    worthCheck: capture.worthCheck,
    worthReason: capture.worthReason,
    meta,
    detectedUrl: capture.detectedUrl,
    // Captures only ever use TEXT/IMAGE/AUDIO of the shared MediaType enum.
    mediaType: capture.mediaType as CaptureDto["mediaType"],
    mediaUrl: capture.mediaUrl,
    createdOutput: (capture.createdOutputs as CaptureDto["createdOutput"]) ?? null,
    createdAt: capture.createdAt,
  }
}

// A media file handed off by the controller. Held in memory so we can both
// persist it and forward it to the multimodal AI in the same flow.
export interface CaptureMediaInput {
  buffer: Buffer
  mimeType: string
}

export interface CreateCaptureInput {
  text?: string
  file?: CaptureMediaInput
  // Absolute origin used to build the public media URL (request-derived or env).
  baseUrl: string
}

// ---- create / read -------------------------------------------------

// Auto-convert threshold: only TASK and VAULT can be created without parent IDs.
const AUTO_CONVERT_THRESHOLD = 0.85

const autoConvert = async (
  captureId: string,
  userId: string,
  rawText: string,
  type: CaptureType,
  meta: Classification["meta"],
  detectedUrl: string | null,
): Promise<void> => {
  let createdId: string

  const title = meta.title ?? rawText.slice(0, 200)

  if (type === "TASK") {
    const task = await createTask({
      userId,
      title,
      priority: (meta.priority as never) ?? "MEDIUM",
      status: "TODO",
      taskType: "BOOLEAN",
      source: "DUMP",
      sourceId: captureId,
      areaId: meta.suggestedAreaId ?? null,
      dueDate: meta.dueDate ? new Date(meta.dueDate) : undefined,
    })
    createdId = task.id
  } else if (type === "VAULT") {
    const item = await createVaultItem({
      userId,
      title,
      content: rawText,
      vaultType: "REFLECTION",
      mediaType: "TEXT",
    })
    createdId = item.id
  } else {
    return
  }

  await updateCapture(captureId, userId, {
    status: "CONVERTED",
    createdOutputs: { type, id: createdId } as Prisma.InputJsonValue,
  })
}

// Classify the dump with the AI (RAG context) and write the result back onto
// the capture; high-confidence TASK/VAULT items auto-convert. Runs in the
// background so the create request can return instantly.
//
// For media captures `text` is the optional caption and `media` carries the
// image/audio bytes; the AI transcribes it and the transcript becomes the
// capture's rawText (used for the title and any auto-convert).
const classifyAndApply = async (
  captureId: string,
  userId: string,
  text: string,
  media?: CaptureMediaInput,
): Promise<void> => {
  const ragContext = await getUserRagContext(userId)
  const result = media
    ? await classifyMediaCapture(media.buffer, media.mimeType, text || undefined, ragContext)
    : await classifyCapture(text, ragContext)

  const detectedUrl = (result.meta.url as string | undefined) ?? null
  // The effective text: transcript for media, else the typed dump.
  const effectiveText = result.transcript ?? text

  await updateCapture(captureId, userId, {
    ...(media && effectiveText ? { rawText: effectiveText } : {}),
    detectedUrl,
    confidence: result.confidence,
    worthCheck: mapWorthCheck(result.worthCheck),
    worthReason: result.worthReason,
    suggestedOutputs: { type: result.type, meta: result.meta } as Prisma.InputJsonValue,
  })

  const canAutoConvert =
    result.confidence >= AUTO_CONVERT_THRESHOLD &&
    (result.type === "TASK" || result.type === "VAULT")

  if (canAutoConvert) {
    await autoConvert(captureId, userId, effectiveText, result.type, result.meta, detectedUrl).catch(
      () => {
        // Swallow — the capture stays PENDING and the user can convert manually
      },
    )
  }
}

const mediaTypeFromMime = (mime: string): MediaType =>
  mime.toLowerCase().startsWith("image/") ? "IMAGE" : "AUDIO"

export const createCaptureService = async (
  userId: string,
  input: CreateCaptureInput,
): Promise<CaptureDto> => {
  // Capture must feel instant: persist the raw dump and return immediately.
  // Classification (an LLM round-trip) and any auto-convert run in the
  // background so the user never waits on the AI to add a thought.
  const caption = input.text?.trim() ?? ""

  // Media capture: store the file first, then classify the bytes in the
  // background. rawText starts as the caption (often empty) and is replaced by
  // the AI transcript once classification lands.
  let mediaType: MediaType = "TEXT"
  let mediaUrl: string | null = null
  if (input.file) {
    mediaType = mediaTypeFromMime(input.file.mimeType)
    const stored = await storage.save(input.file.buffer, {
      ext: extFromMime(input.file.mimeType),
      subdir: "captures",
    })
    mediaUrl = `${input.baseUrl}${stored.url}`
  }

  const capture = await createCapture({
    userId,
    rawText: caption,
    mediaType,
    mediaUrl,
    status: "PENDING",
  })

  logBehavior(userId, "CAPTURE_CREATED", { captureId: capture.id, mediaType })

  void classifyAndApply(capture.id, userId, caption, input.file).catch((err) => {
    logger.error("Background capture classification failed:", err)
  })

  return toDto(capture)
}

export const listCapturesService = async (
  userId: string,
  filters: ListCapturesDto,
): Promise<CaptureDto[] | ReturnType<typeof paginatedResponse>> => {
  const statusFilter =
    filters.processed === "false"
      ? { status: "PENDING" as const }
      : filters.processed === "true"
        ? { status: { not: "PENDING" as const } }
        : {}

  if (filters.page || filters.limit) {
    const params = getPagination(filters.page, filters.limit)
    const [captures, total] = await Promise.all([
      findCapturesByUser(userId, statusFilter, params.skip, params.limit),
      countCapturesByUser(userId, statusFilter),
    ])
    return paginatedResponse(captures.map(toDto), total, params)
  }

  const captures = await findCapturesByUser(userId, statusFilter)
  return captures.map(toDto)
}

export const updateCaptureTypeService = async (
  id: string,
  userId: string,
  input: UpdateCaptureDto,
): Promise<CaptureDto> => {
  const capture = await getOwnedCapture(id, userId)
  const { meta } = readClassification(capture)
  await updateCapture(id, userId, {
    suggestedOutputs: { type: input.type, meta } as Prisma.InputJsonValue,
  })
  const updated = await getOwnedCapture(id, userId)
  return toDto(updated)
}

export const deleteCaptureService = async (id: string, userId: string): Promise<void> => {
  await getOwnedCapture(id, userId)
  await deleteCapture(id, userId)
}

// ---- convert (the hero step) ---------------------------------------

const assertAreaOwned = async (areaId: string, userId: string) => {
  if (!(await findAreaById(areaId, userId))) throw new NotFoundError("Area not found")
}
const assertTopicOwned = async (topicId: string, userId: string) => {
  const topic = await findTopicById(topicId, userId)
  if (!topic) throw new NotFoundError("Topic not found")
  return topic
}

// Resolves the effective areaId: user override → AI suggestion → null.
// Validates ownership when an id is used.
const resolveAreaId = async (
  overrideId: string | undefined,
  suggestedId: string | undefined,
  userId: string,
): Promise<string | null> => {
  const id = overrideId ?? suggestedId ?? null
  if (id) await assertAreaOwned(id, userId)
  return id
}

// Also returns the topic's areaId (when known) so a follow-up task can
// inherit the right area without a second lookup.
const resolveTopicId = async (
  overrideId: string | undefined,
  suggestedId: string | undefined,
  userId: string,
  required: boolean,
): Promise<{ topicId: string | null; areaId: string | null }> => {
  const id = overrideId ?? suggestedId ?? null
  if (required && !id) throw new ValidationError("topicId is required (or couldn't be inferred from context)")
  if (!id) return { topicId: null, areaId: null }
  const topic = await assertTopicOwned(id, userId)
  return { topicId: id, areaId: topic.areaId ?? null }
}

// The "learn-and-forget loop": create one concrete follow-up Task for a
// newly-created Note/Resource and link Task -ADVANCES-> source, so a saved
// idea has a real next action attached instead of just sitting in the
// Library. Opt-in only (overrides.createFollowUpTask), never automatic —
// failures here are swallowed so a linking hiccup can't fail the convert.
const maybeCreateFollowUpTask = async (
  userId: string,
  sourceType: "NOTE" | "RESOURCE",
  source: { id: string; title: string; areaId: string | null },
  overrides: ConvertCaptureDto,
): Promise<void> => {
  if (!overrides.createFollowUpTask) return
  try {
    const task = await createTask({
      userId,
      areaId: source.areaId,
      title: overrides.followUpTaskTitle?.trim() || `Act on: ${source.title}`,
      priority: "MEDIUM",
      status: "TODO",
      taskType: "BOOLEAN",
      source: "DUMP",
      sourceId: source.id,
    })
    await createLink({
      userId,
      fromType: "TASK",
      fromId: task.id,
      toType: sourceType,
      toId: source.id,
      role: "ADVANCES",
    })
  } catch (err) {
    logger.error("Follow-up task creation failed (capture still converted):", err)
  }
}

export const convertCaptureService = async (
  id: string,
  userId: string,
  overrides: ConvertCaptureDto,
): Promise<{ capture: CaptureDto; created: { type: CaptureType; entity: unknown } }> => {
  const capture = await getOwnedCapture(id, userId)
  if (capture.status !== "PENDING") {
    throw new ValidationError("Capture has already been processed")
  }

  const { type, meta } = readClassification(capture)
  const text = capture.rawText
  const title = meta.title ?? text.slice(0, 200)

  let createdId: string
  let entity: unknown

  switch (type) {
    case "TASK": {
      const areaId = await resolveAreaId(overrides.areaId, meta.suggestedAreaId, userId)
      const task = await createTask({
        userId,
        areaId,
        title,
        priority: overrides.priority ?? (meta.priority as never) ?? "MEDIUM",
        status: "TODO",
        taskType: "BOOLEAN",
        source: "DUMP",
        sourceId: capture.id,
        dueDate: meta.dueDate ? new Date(meta.dueDate) : undefined,
      })
      createdId = task.id
      entity = task
      break
    }
    case "HABIT": {
      const areaId = overrides.areaId ?? meta.suggestedAreaId
      if (!areaId) throw new ValidationError("areaId is required to convert to a habit")
      await assertAreaOwned(areaId, userId)
      const habit = await createHabit({
        userId,
        areaId,
        title,
        habitType: "BOOLEAN",
        frequency: (meta.frequency as never) ?? "DAILY",
        targetCount: meta.targetCount,
        targetMinutes: meta.targetMinutes,
      })
      createdId = habit.id
      entity = habit
      break
    }
    case "NOTE": {
      const { topicId, areaId } = await resolveTopicId(overrides.topicId, meta.suggestedTopicId, userId, true)
      const note = await createNote({
        userId,
        topicId: topicId!,
        title,
        content: text,
        noteType: "CONCEPT",
        tags: (meta.tags as string[]) ?? [],
      })
      createdId = note.id
      entity = note
      await maybeCreateFollowUpTask(userId, "NOTE", { id: note.id, title: note.title, areaId }, overrides)
      break
    }
    case "RESOURCE": {
      const { topicId, areaId } = await resolveTopicId(overrides.topicId, meta.suggestedTopicId, userId, true)
      const resource = await createResource({
        userId,
        topicId: topicId!,
        title,
        resourceType: (meta.resourceType as never) ?? (capture.detectedUrl ? "ARTICLE" : "OTHER"),
        url: capture.detectedUrl,
        platform: meta.platform,
      })
      createdId = resource.id
      entity = resource
      await maybeCreateBacklogReminder(userId, resource.id)
      await maybeCreateFollowUpTask(userId, "RESOURCE", { id: resource.id, title: resource.title, areaId }, overrides)
      break
    }
    case "VAULT": {
      const item = await createVaultItem({
        userId,
        title,
        content: text,
        vaultType: "REFLECTION",
        mediaType: "TEXT",
      })
      createdId = item.id
      entity = item
      break
    }
    default:
      throw new ValidationError("Unknown capture type")
  }

  await updateCapture(id, userId, {
    status: "CONVERTED",
    createdOutputs: { type, id: createdId } as Prisma.InputJsonValue,
  })
  const updated = await getOwnedCapture(id, userId)

  return { capture: toDto(updated), created: { type, entity } }
}

export const createCaptureAndProcessSync = async (
  userId: string,
  text: string,
): Promise<{
  capture: CaptureDto
  autoConverted: boolean
  convertedType?: string
  convertedId?: string
  summary: string
}> => {
  // 1. Get RAG context and classify the text synchronously
  const ragContext = await getUserRagContext(userId)
  const result = await classifyCapture(text, ragContext)
  const detectedUrl = (result.meta.url as string | undefined) ?? null
  const effectiveText = result.transcript ?? text

  // 2. Create the capture in the DB
  const capture = await createCapture({
    userId,
    rawText: effectiveText,
    mediaType: "TEXT",
    mediaUrl: null,
    status: "PENDING",
  })

  // 3. Update the capture with the classification results
  await updateCapture(capture.id, userId, {
    detectedUrl,
    confidence: result.confidence,
    worthCheck: mapWorthCheck(result.worthCheck),
    worthReason: result.worthReason,
    suggestedOutputs: { type: result.type, meta: result.meta } as Prisma.InputJsonValue,
  })

  // 4. Check if it should auto-convert
  const canAutoConvert =
    result.confidence >= AUTO_CONVERT_THRESHOLD &&
    (result.type === "TASK" || result.type === "VAULT")

  let autoConverted = false

  if (canAutoConvert) {
    try {
      await autoConvert(capture.id, userId, effectiveText, result.type, result.meta, detectedUrl)
      autoConverted = true
    } catch (err) {
      logger.error("Auto-convert failed in sync capture:", err)
    }
  }

  // Get the updated capture so we can return its final state (including createdOutputs if converted)
  const updated = await getOwnedCapture(capture.id, userId)
  const createdOutput = (updated.createdOutputs as CaptureDto["createdOutput"]) ?? null

  // 5. Generate a nice summary message
  let summary = ""
  if (autoConverted && createdOutput) {
    if (result.type === "TASK") {
      summary = `I've created a task for you: "${result.meta.title || effectiveText}"`
      if (result.meta.priority) summary += ` (${result.meta.priority} priority)`
      if (result.meta.dueDate) {
        summary += ` due by ${result.meta.dueDate}`
      }
      summary += "."
    } else if (result.type === "VAULT") {
      summary = `I've saved a reflection to your Vault: "${result.meta.title || effectiveText}".`
    }
  } else {
    // Not auto-converted
    const typeLabel = result.type.toLowerCase()
    summary = `I've saved that as a prospective ${typeLabel} in your inbox.`
    if (result.meta.suggestedAreaName) {
      summary += ` (Suggested area: ${result.meta.suggestedAreaName})`
    } else if (result.meta.suggestedTopicName) {
      summary += ` (Suggested topic: ${result.meta.suggestedTopicName})`
    }
  }

  return {
    capture: toDto(updated),
    autoConverted,
    convertedType: result.type,
    convertedId: createdOutput?.id,
    summary,
  }
}

