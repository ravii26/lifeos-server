/* =====================================================================
   Activity log: an append-only history of everything that happened.
   Progress, patterns, forecasts, the weekly view and undo are computed
   from it, so nothing progress-related is ever hand-maintained.
   Recording never breaks the action it describes: failures are logged.
   ===================================================================== */
import type { ActivityEvent, ActivityItem, ActivitySource, ActivityType, Prisma } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import logger from "../../lib/logger.js"
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
  | { kind: "DELETE_METRIC_ENTRY"; entryId: string }
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
const applyUndo = async (userId: string, undo: UndoPayload): Promise<void> => {
  switch (undo.kind) {
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
    case "RESTORE_MEMORY":
      await prisma.memory.create({
        data: {
          userId,
          content: undo.memory.content,
          kind: undo.memory.kind as never,
          importance: undo.memory.importance,
          source: undo.memory.source as never,
          sensitive: undo.memory.sensitive,
        },
      })
      return
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
