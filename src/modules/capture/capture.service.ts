import type { Prisma } from "@prisma/client"
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
import { classifyCapture, type CaptureType } from "./capture.ai.js"
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

// Classification lives in the suggestedOutputs JSON column. This reads it
// back out in a typed way.
const readClassification = (
  capture: { suggestedOutputs: Prisma.JsonValue },
): { type: CaptureType; meta: Record<string, unknown> } => {
  const raw = (capture.suggestedOutputs ?? {}) as {
    type?: CaptureType
    meta?: Record<string, unknown>
  }
  return { type: raw.type ?? "TASK", meta: raw.meta ?? {} }
}

// Flattens a DB row into the friendly client shape.
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

export const createCaptureService = async (
  userId: string,
  input: CreateCaptureDto,
): Promise<CaptureDto> => {
  // The "AI triage" — heuristic today, a Claude call tomorrow (see capture.ai.ts).
  const result = await classifyCapture(input.text)
  const detectedUrl = (result.meta.url as string | undefined) ?? null

  const capture = await createCapture({
    userId,
    rawText: input.text,
    detectedUrl,
    confidence: result.confidence,
    status: "PENDING",
    suggestedOutputs: { type: result.type, meta: result.meta } as Prisma.InputJsonValue,
  })

  logBehavior(userId, "CAPTURE_CREATED", { captureId: capture.id, type: result.type })
  return toDto(capture)
}

export const listCapturesService = async (
  userId: string,
  filters: ListCapturesDto,
): Promise<CaptureDto[]> => {
  // processed === !PENDING. Filter on status accordingly.
  const statusFilter =
    filters.processed === "false"
      ? { status: "PENDING" as const }
      : filters.processed === "true"
        ? { status: { not: "PENDING" as const } }
        : {}

  const captures = await findCapturesByUser(userId, statusFilter)
  return captures.map(toDto)
}

// Override the AI's guessed type before converting.
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

// Turns a capture into a real Task / Habit / Note / Resource / VaultItem,
// marks it CONVERTED, and records what was created. Returns the new entity.
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
  let createdId: string
  let entity: unknown

  switch (type) {
    case "TASK": {
      const areaId = overrides.areaId ?? null
      if (areaId) await assertAreaOwned(areaId, userId)
      const task = await createTask({
        userId,
        areaId,
        title: text,
        priority: overrides.priority ?? (meta.priority as never) ?? "MEDIUM",
        status: "TODO",
        taskType: "BOOLEAN",
        source: "DUMP",
        sourceId: capture.id,
      })
      createdId = task.id
      entity = task
      break
    }
    case "HABIT": {
      // A habit must live in an area.
      if (!overrides.areaId) throw new ValidationError("areaId is required to convert to a habit")
      await assertAreaOwned(overrides.areaId, userId)
      const habit = await createHabit({
        userId,
        areaId: overrides.areaId,
        title: text,
        habitType: "BOOLEAN",
        frequency: "DAILY",
      })
      createdId = habit.id
      entity = habit
      break
    }
    case "NOTE": {
      // A note must live under a topic.
      if (!overrides.topicId) throw new ValidationError("topicId is required to convert to a note")
      await assertTopicOwned(overrides.topicId, userId)
      const note = await createNote({
        userId,
        topicId: overrides.topicId,
        title: text.slice(0, 200),
        content: text,
        noteType: "CONCEPT",
        tags: (meta.tags as string[]) ?? [],
      })
      createdId = note.id
      entity = note
      break
    }
    case "RESOURCE": {
      if (!overrides.topicId) throw new ValidationError("topicId is required to convert to a resource")
      await assertTopicOwned(overrides.topicId, userId)
      const resource = await createResource({
        userId,
        topicId: overrides.topicId,
        title: text.slice(0, 200),
        resourceType: capture.detectedUrl ? "ARTICLE" : "OTHER",
        url: capture.detectedUrl,
      })
      createdId = resource.id
      entity = resource
      break
    }
    case "VAULT": {
      const item = await createVaultItem({
        userId,
        title: text.slice(0, 200),
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
