/* =====================================================================
   Activity log: an append-only history of everything that happened.
   Progress, patterns, forecasts, the weekly view and undo are computed
   from it, so nothing progress-related is ever hand-maintained.
   Recording never breaks the action it describes: failures are logged.
   ===================================================================== */
import { Prisma } from "@prisma/client"
import type { ActivityEvent, ActivityItem, ActivitySource, ActivityType } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import logger from "../../lib/logger.js"
import { embedMemory } from "../assistant/assistant.memory.semantic.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"

export interface ActivityInput {
  type: ActivityType
  itemType: ActivityItem
  itemId?: string | null
  title?: string | null
  value?: number | null
  minutes?: number | null
  reason?: string | null
  mood?: string | null
  block?: string | null
  source?: ActivitySource
  // What's needed to reverse this action. Absent = not undoable.
  undo?: UndoPayload | null
}

export type UndoPayload =
  | { kind: "ARCHIVE_TASK"; taskId: string }
  | { kind: "REOPEN_TASK"; taskId: string; prevStatus: string; prevCompletedAt: string | null }
  | { kind: "UNLOG_HABIT"; habitId: string; date: string; prev: { completed: boolean; count: number; minutes: number } | null }
  // Progress is derived from the log, so undoing a logged count only marks the event undone.
  | { kind: "NOOP" }
  | { kind: "RESTORE_ARCHIVED"; items: { taskId: string; prevStatus: string }[] }
  | { kind: "RESTORE_NOTE"; noteId: string; collection: string; title: string; items: string[]; text: string | null; done?: string[]; meta?: unknown }
  | { kind: "RESTORE_ALLY_NOTE"; note: { collection: string; template: string; title: string; items: string[]; text: string | null; done?: string[]; meta?: unknown } }
  | { kind: "DELETE_METRIC_ENTRY"; entryId: string }
  | { kind: "DELETE_LOG_ENTRY"; entryId: string }
  | { kind: "RESTORE_LOG_ENTRY"; entry: { series: string; value: number; unit: string; label: string | null; date: string } }
  | { kind: "DELETE_TIME_ENTRY"; entryId: string }
  // Saves put back to waiting for a decision (let go of old saves, or moved to watch later).
  | { kind: "RESET_SAVES"; ids: string[] }
  | { kind: "RESTORE_TIME_ENTRY"; entry: { label: string; itemType: string | null; itemId: string | null; startedAt: string; date: string } }
  | { kind: "RESTORE_MILESTONE"; milestoneId: string }
  | { kind: "RESTORE_PROJECT_STATUS"; projectId: string; prev: string }
  | { kind: "RESTORE_DUE"; items: { taskId: string; prev: string | null }[] }
  | { kind: "RESTORE_MODE"; prev: string; prevUntil: string | null }
  | { kind: "RESTORE_SCHEDULE"; weekdays: number[]; prev: { weekday: number; blocks: unknown }[] }
  | { kind: "ARCHIVE_HABIT"; habitId: string }
  | { kind: "ARCHIVE_PROJECT"; projectId: string }
  | { kind: "DELETE_ALLY_NOTE"; noteId: string }
  // One chat message can create several things; one payload reverses them all.
  | { kind: "MANY"; items: UndoPayload[] }
  | { kind: "DELETE_MEMORY"; memoryId: string }
  | { kind: "RESTORE_MEMORY"; memory: { content: string; kind: string; importance: number; source: string; sensitive: boolean } }
  | { kind: "RESTORE_SETTING"; field: "nightlyTime"; prev: string | null }
  | { kind: "RESET_COMMITMENT"; commitmentId: string; then?: UndoPayload }
  // Reverse another logged event (e.g. the task a guide answer completed).
  | { kind: "UNDO_EVENT"; eventId: string }
  // Put back a few fields the brain's advice changed (smaller, weekend, let go, busy until).
  | { kind: "RESTORE_FIELDS"; model: "task" | "habit" | "project" | "settings" | "goal" | "allyNote" | "area" | "memory"; id: string; prev: Record<string, unknown> }

export interface ActivityOptions {
  source?: ActivitySource
}

export const recordActivity = async (userId: string, input: ActivityInput): Promise<ActivityEvent | null> => {
  try {
    return await prisma.activityEvent.create({
      data: {
        userId,
        type: input.type,
        itemType: input.itemType,
        itemId: input.itemId ?? null,
        title: input.title?.slice(0, 200) ?? null,
        value: input.value ?? null,
        minutes: input.minutes ?? null,
        reason: input.reason?.slice(0, 300) ?? null,
        mood: input.mood ?? null,
        block: input.block ?? null,
        source: input.source ?? "APP",
        undo: (input.undo ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
  } catch (err) {
    logger.warn(`Activity log write failed (${input.type} ${input.itemType}):`, err)
    return null
  }
}

export const listActivity = (userId: string, since: Date, limit = 200) =>
  prisma.activityEvent.findMany({
    where: { userId, at: { gte: since } },
    orderBy: { at: "desc" },
    take: limit,
  })

// Reverses one step. Each payload kind restores exactly the state saved when
// the action happened; the event is marked undone so it can't run twice.
// Only these fields can be put back by RESTORE_FIELDS; dates travel as ISO strings.
const RESTORABLE: Record<"task" | "habit" | "project" | "settings" | "goal" | "allyNote" | "area" | "memory", string[]> = {
  task: ["sizeMinutes", "dueDate", "status", "archivedAt", "remindAt", "windowEnd", "title", "priority"],
  habit: ["targetMinutes", "frequency", "specificDays", "isActive", "reminderTime", "title", "habitType", "targetCount"],
  project: ["sessionMinutes", "status", "title", "priority", "deadline"],
  area: ["name", "tier", "isActive"],
  memory: ["sensitive"],
  allyNote: ["title"],
  settings: ["busyUntil", "focus", "directness", "proactivity"],
  goal: ["status", "parkedAt"],
}
const DATE_FIELDS = new Set(["dueDate", "archivedAt", "busyUntil", "parkedAt", "remindAt", "windowEnd", "deadline"])

const restoreFields = async (userId: string, undo: Extract<UndoPayload, { kind: "RESTORE_FIELDS" }>) => {
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(undo.prev)) {
    if (!RESTORABLE[undo.model].includes(k)) continue
    data[k] = DATE_FIELDS.has(k) && typeof v === "string" ? new Date(v) : v
  }
  if (!Object.keys(data).length) return
  if (undo.model === "task") await prisma.task.updateMany({ where: { id: undo.id, userId }, data })
  else if (undo.model === "habit") await prisma.habit.updateMany({ where: { id: undo.id, userId }, data })
  else if (undo.model === "project") await prisma.project.updateMany({ where: { id: undo.id, userId }, data })
  else if (undo.model === "goal") await prisma.goal.updateMany({ where: { id: undo.id, userId }, data })
  else if (undo.model === "allyNote") await prisma.allyNote.updateMany({ where: { id: undo.id, userId }, data })
  else if (undo.model === "area") await prisma.area.updateMany({ where: { id: undo.id, userId }, data })
  else if (undo.model === "memory") await prisma.memory.updateMany({ where: { id: undo.id, userId }, data })
  else await prisma.userSettings.updateMany({ where: { userId }, data })
}

const applyUndo = async (userId: string, undo: UndoPayload): Promise<void> => {
  switch (undo.kind) {
    case "RESTORE_FIELDS":
      await restoreFields(userId, undo)
      return
    case "ARCHIVE_TASK":
      await prisma.task.updateMany({
        where: { id: undo.taskId, userId },
        data: { archivedAt: new Date(), status: "CANCELLED" },
      })
      return
    case "REOPEN_TASK":
      await prisma.task.updateMany({
        where: { id: undo.taskId, userId },
        data: {
          status: undo.prevStatus as "TODO" | "IN_PROGRESS",
          completedAt: undo.prevCompletedAt ? new Date(undo.prevCompletedAt) : null,
        },
      })
      return
    case "NOOP":
      return
    case "RESTORE_ARCHIVED":
      for (const i of undo.items) {
        await prisma.task.updateMany({ where: { id: i.taskId, userId }, data: { archivedAt: null, status: i.prevStatus as "TODO" } })
      }
      return
    case "RESTORE_NOTE":
      await prisma.allyNote.updateMany({
        where: { id: undo.noteId, userId },
        data: { collection: undo.collection, title: undo.title, items: undo.items, text: undo.text, ...(undo.done && { done: undo.done }), ...(undo.meta !== undefined && { meta: undo.meta as never }) },
      })
      return
    case "RESTORE_ALLY_NOTE":
      await prisma.allyNote.create({ data: { userId, ...undo.note, template: undo.note.template as "LIST", meta: (undo.note.meta ?? undefined) as never } })
      return
    case "RESET_SAVES":
      await prisma.capture.updateMany({ where: { id: { in: undo.ids }, userId }, data: { status: "PENDING", createdOutputs: Prisma.JsonNull } })
      return
    case "DELETE_TIME_ENTRY":
      await prisma.timeEntry.deleteMany({ where: { id: undo.entryId, userId } })
      return
    case "RESTORE_TIME_ENTRY": {
      // A discarded timer comes back running, unless another one has started since.
      if (await prisma.timeEntry.findFirst({ where: { userId, endedAt: null }, select: { id: true } })) return
      await prisma.timeEntry.create({
        data: { userId, label: undo.entry.label, itemType: undo.entry.itemType, itemId: undo.entry.itemId, startedAt: new Date(undo.entry.startedAt), date: new Date(undo.entry.date) },
      })
      return
    }
    case "RESTORE_LOG_ENTRY":
      await prisma.logEntry.create({ data: { userId, series: undo.entry.series, value: undo.entry.value, unit: undo.entry.unit, label: undo.entry.label, date: new Date(undo.entry.date) } })
      return
    case "DELETE_LOG_ENTRY":
      await prisma.logEntry.deleteMany({ where: { id: undo.entryId, userId } })
      return
    case "DELETE_METRIC_ENTRY":
      // Scoped through the metric's project so another user's entry can never be hit.
      await prisma.metricEntry.deleteMany({ where: { id: undo.entryId, metric: { project: { userId } } } })
      return
    case "RESTORE_MILESTONE":
      await prisma.milestone.updateMany({ where: { id: undo.milestoneId, project: { userId } }, data: { doneAt: null } })
      return
    case "RESTORE_PROJECT_STATUS":
      await prisma.project.updateMany({ where: { id: undo.projectId, userId }, data: { status: undo.prev as "ACTIVE" } })
      return
    case "RESTORE_DUE":
      for (const i of undo.items) {
        await prisma.task.updateMany({ where: { id: i.taskId, userId }, data: { dueDate: i.prev ? new Date(i.prev) : null } })
      }
      return
    case "RESTORE_MODE":
      await prisma.userSettings.updateMany({
        where: { userId },
        data: { mode: undo.prev, modeUntil: undo.prevUntil ? new Date(undo.prevUntil) : null },
      })
      return
    case "RESTORE_SCHEDULE": {
      // Days that had no custom schedule go back to the default (row removed).
      const had = new Set(undo.prev.map((p) => p.weekday))
      await prisma.daySchedule.deleteMany({ where: { userId, weekday: { in: undo.weekdays.filter((d) => !had.has(d)) } } })
      for (const p of undo.prev) {
        await prisma.daySchedule.updateMany({ where: { userId, weekday: p.weekday }, data: { blocks: p.blocks as Prisma.InputJsonValue } })
      }
      return
    }
    case "ARCHIVE_HABIT":
      await prisma.habit.updateMany({ where: { id: undo.habitId, userId }, data: { isActive: false } })
      return
    case "ARCHIVE_PROJECT":
      // Undoing a creation never deletes: the project is let go, its to-dos archived.
      await prisma.project.updateMany({ where: { id: undo.projectId, userId }, data: { status: "ABANDONED" } })
      await prisma.task.updateMany({
        where: { projectId: undo.projectId, userId, status: { in: ["TODO", "IN_PROGRESS"] } },
        data: { archivedAt: new Date(), status: "CANCELLED" },
      })
      return
    case "DELETE_ALLY_NOTE":
      await prisma.allyNote.deleteMany({ where: { id: undo.noteId, userId } })
      return
    case "MANY":
      for (const item of undo.items) await applyUndo(userId, item)
      return
    case "UNLOG_HABIT": {
      const date = new Date(undo.date)
      if (undo.prev) {
        await prisma.habitLog.updateMany({ where: { habitId: undo.habitId, userId, date }, data: undo.prev })
      } else {
        await prisma.habitLog.deleteMany({ where: { habitId: undo.habitId, userId, date } })
      }
      return
    }
    case "DELETE_MEMORY":
      await prisma.memory.deleteMany({ where: { id: undo.memoryId, userId } })
      return
    case "RESTORE_MEMORY": {
      const restored = await prisma.memory.create({
        data: {
          userId,
          content: undo.memory.content,
          kind: undo.memory.kind as never,
          importance: undo.memory.importance,
          source: undo.memory.source as never,
          sensitive: undo.memory.sensitive,
        },
      })
      void embedMemory(restored.id, restored.content, restored.sensitive)
      return
    }
    case "RESTORE_SETTING":
      await prisma.userSettings.updateMany({ where: { userId }, data: { [undo.field]: undo.prev } })
      return
    case "RESET_COMMITMENT":
      await prisma.nightlyCommitment.updateMany({
        where: { id: undo.commitmentId, userId },
        data: { status: "PENDING", skipReason: null, respondedAt: null },
      })
      if (undo.then) await applyUndo(userId, undo.then)
      return
    case "UNDO_EVENT":
      await undoActivityService(userId, undo.eventId).catch((err) =>
        logger.warn(`Nested undo of ${undo.eventId} skipped:`, err),
      )
      return
  }
}

export const undoActivityService = async (userId: string, eventId: string): Promise<ActivityEvent> => {
  const event = await prisma.activityEvent.findFirst({ where: { id: eventId, userId } })
  if (!event) throw new NotFoundError("Nothing to undo")
  if (event.undoneAt) throw new ValidationError("Already undone")
  if (!event.undo) throw new ValidationError("This can't be undone")

  await applyUndo(userId, event.undo as unknown as UndoPayload)
  return prisma.activityEvent.update({ where: { id: event.id }, data: { undoneAt: new Date() } })
}
