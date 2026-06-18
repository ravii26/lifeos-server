import type { Prisma, WorthCheck } from "@prisma/client"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { findAreaById } from "../area/area.repository.js"
import { findTopicById } from "../topic/topic.repository.js"
import { createTask } from "../task/task.repository.js"
import { createHabit } from "../habit/habit.repository.js"
import { createNote } from "../note/note.repository.js"
import { createResource } from "../resource/resource.repository.js"
import { createVaultItem } from "../vault/vault.repository.js"
import {
  createCapture,
  findCapturesByUser,
  findCaptureById,
  updateCapture,
  deleteCapture,
} from "./capture.repository.js"
import { classifyCapture, type CaptureType, type Classification } from "./capture.ai.js"
import { getUserRagContext } from "../../lib/rag.js"
import type {
  CreateCaptureDto,
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
  detectedUrl: string | null
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
    meta,
    detectedUrl: capture.detectedUrl,
    createdOutput: (capture.createdOutputs as CaptureDto["createdOutput"]) ?? null,
    createdAt: capture.createdAt,
  }
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

  await updateCapture(captureId, {
    status: "CONVERTED",
    createdOutputs: { type, id: createdId } as Prisma.InputJsonValue,
  })
}

export const createCaptureService = async (
  userId: string,
  input: CreateCaptureDto,
): Promise<CaptureDto> => {
  // Fetch user context in parallel with nothing (classification needs it).
  const ragContext = await getUserRagContext(userId)
  const result = await classifyCapture(input.text, ragContext)

  const detectedUrl = (result.meta.url as string | undefined) ?? null

  const canAutoConvert = result.confidence >= AUTO_CONVERT_THRESHOLD &&
    (result.type === "TASK" || result.type === "VAULT")

  const capture = await createCapture({
    userId,
    rawText: input.text,
    detectedUrl,
    confidence: result.confidence,
    status: "PENDING",
    worthCheck: mapWorthCheck(result.worthCheck),
    worthReason: result.worthReason,
    suggestedOutputs: { type: result.type, meta: result.meta } as Prisma.InputJsonValue,
  })

  logBehavior(userId, "CAPTURE_CREATED", { captureId: capture.id, type: result.type })

  if (canAutoConvert) {
    void autoConvert(capture.id, userId, input.text, result.type, result.meta, detectedUrl)
      .catch(() => {
        // Swallow — the capture stays PENDING and the user can convert manually
      })
  }
  return toDto(capture)
}

export const listCapturesService = async (
  userId: string,
  filters: ListCapturesDto,
): Promise<CaptureDto[]> => {
  const statusFilter =
    filters.processed === "false"
      ? { status: "PENDING" as const }
      : filters.processed === "true"
        ? { status: { not: "PENDING" as const } }
        : {}

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
  const updated = await updateCapture(id, {
    suggestedOutputs: { type: input.type, meta } as Prisma.InputJsonValue,
  })
  return toDto(updated)
}

export const deleteCaptureService = async (id: string, userId: string): Promise<void> => {
  await getOwnedCapture(id, userId)
  await deleteCapture(id)
}

// ---- convert (the hero step) ---------------------------------------

const assertAreaOwned = async (areaId: string, userId: string) => {
  if (!(await findAreaById(areaId, userId))) throw new NotFoundError("Area not found")
}
const assertTopicOwned = async (topicId: string, userId: string) => {
  if (!(await findTopicById(topicId, userId))) throw new NotFoundError("Topic not found")
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

const resolveTopicId = async (
  overrideId: string | undefined,
  suggestedId: string | undefined,
  userId: string,
  required: boolean,
): Promise<string | null> => {
  const id = overrideId ?? suggestedId ?? null
  if (required && !id) throw new ValidationError("topicId is required (or couldn't be inferred from context)")
  if (id) await assertTopicOwned(id, userId)
  return id
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
      const topicId = await resolveTopicId(overrides.topicId, meta.suggestedTopicId, userId, true)
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
      break
    }
    case "RESOURCE": {
      const topicId = await resolveTopicId(overrides.topicId, meta.suggestedTopicId, userId, true)
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

  const updated = await updateCapture(id, {
    status: "CONVERTED",
    createdOutputs: { type, id: createdId } as Prisma.InputJsonValue,
  })

  return { capture: toDto(updated), created: { type, entity } }
}
