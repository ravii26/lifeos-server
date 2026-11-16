// Steps from an area page: add, edit, move, let go. Each one is a task
// underneath, and each change can be undone.

import prisma from "../../lib/prisma.js"
import type { ActivitySource } from "@prisma/client"
import { recordActivity } from "../activity/activity.service.js"
import { createTaskService } from "../task/task.service.js"
import { getClock } from "../now/now.service.js"
import { holdReason } from "../now/pile.rules.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { dateFromKey } from "../../shared/utils/time.util.js"
import { diffEdit, moveTargetKey, moveWords, type Move, type StepEdit } from "./step.rules.js"
import { checkWhen, kindOf, type When } from "./when.rules.js"
import { utcDayKey } from "../../shared/utils/time.util.js"

const iso = (d: Date | null) => (d ? d.toISOString() : null)

const ownedOpenStep = async (userId: string, id: string) => {
  const t = await prisma.task.findFirst({
    where: { id, userId, archivedAt: null },
    select: { id: true, title: true, sizeMinutes: true, energy: true, minimumVersion: true, dueDate: true, dueKind: true, windowFrom: true, windowTo: true, status: true },
  })
  if (!t) throw new NotFoundError("Step not found")
  return t
}

export const addStepService = async (
  userId: string,
  input: { areaId: string; goalId?: string | null; title: string; when?: Partial<When> } & StepEdit,
  source: ActivitySource = "APP",
) => {
  const title = input.title.trim()
  if (!title) throw new ValidationError("Give the step a name.")
  // A step for a milestone (or goal): only one of this person's, in this area.
  const goalId = input.goalId
    ? (await prisma.goal.findFirst({ where: { id: input.goalId, userId, areaId: input.areaId }, select: { id: true } }))?.id
    : undefined
  if (input.goalId && !goalId) throw new NotFoundError("Goal not found")
  const when = input.when ? checkWhen(input.when, (await getClock(userId)).todayKey) : null
  // createTaskService checks the area belongs to this person and records an undoable "created".
  const t = await createTaskService(
    userId,
    {
      areaId: input.areaId,
      goalId,
      title,
      sizeMinutes: input.sizeMinutes ?? undefined,
      energy: input.energy ?? undefined,
      minimumVersion: input.minimumVersion?.trim() || undefined,
      dueDate: when?.dueKey ? dateFromKey(when.dueKey) : undefined,
      dueKind: when?.dueKind ?? undefined,
      windowFrom: when?.windowFrom ?? undefined,
      windowTo: when?.windowTo ?? undefined,
    },
    { source },
  )
  return { id: t.id, message: `${title} added.`, activityId: t.activityId }
}

// `when` (on a day, by a day, a window of hours; all empty = anytime) replaces
// what was set before. It is saved with the other changes, under one Undo.
export const editStepService = async (userId: string, id: string, edit: StepEdit & { when?: Partial<When> }, source: ActivitySource = "APP") => {
  const t = await ownedOpenStep(userId, id)
  const { data, prev } = diffEdit(t, edit)
  if (edit.when) {
    const next = checkWhen(edit.when, (await getClock(userId)).todayKey)
    const was: When = { dueKey: t.dueDate ? utcDayKey(t.dueDate) : null, dueKind: t.dueKind as When["dueKind"], windowFrom: t.windowFrom, windowTo: t.windowTo }
    if (next.dueKey !== was.dueKey || kindOf(next) !== kindOf(was) || next.windowFrom !== was.windowFrom || next.windowTo !== was.windowTo) {
      Object.assign(data, { dueDate: next.dueKey ? dateFromKey(next.dueKey) : null, dueKind: next.dueKind, windowFrom: next.windowFrom, windowTo: next.windowTo })
      Object.assign(prev, { dueDate: iso(t.dueDate), dueKind: t.dueKind, windowFrom: t.windowFrom, windowTo: t.windowTo })
    }
  }
  if (!Object.keys(data).length) return { message: "Nothing changed.", activityId: undefined }
  await prisma.task.update({ where: { id: t.id }, data })
  const title = (data.title as string | undefined) ?? t.title
  const ev = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "TASK",
    itemId: t.id,
    title,
    source,
    undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev },
  })
  return { message: "Saved.", activityId: ev?.id }
}

export const moveStepService = async (userId: string, id: string, move: Move, source: ActivitySource = "APP") => {
  const t = await ownedOpenStep(userId, id)
  const c = await getClock(userId)
  const key = moveTargetKey(move, c.todayKey)
  // Moved to a day means on that day: it is not a deadline.
  await prisma.task.update({ where: { id: t.id }, data: { dueDate: dateFromKey(key), dueKind: "ON" } })
  const message = `${t.title} moved to ${moveWords(move)}.`
  // The hold keeps it out of suggestions until that day, like "Not now".
  const ev = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "TASK",
    itemId: t.id,
    title: message,
    reason: holdReason(key),
    source,
    undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev: { dueDate: iso(t.dueDate), dueKind: t.dueKind } },
  })
  return { message, activityId: ev?.id }
}

// "Delete" archives: nothing is destroyed, and Undo brings it back.
export const letGoStepService = async (userId: string, id: string, source: ActivitySource = "APP") => {
  const t = await ownedOpenStep(userId, id)
  await prisma.task.update({ where: { id: t.id }, data: { status: "CANCELLED", archivedAt: new Date() } })
  const message = `Let go of ${t.title}.`
  const ev = await recordActivity(userId, {
    type: "ARCHIVED",
    itemType: "TASK",
    itemId: t.id,
    title: message,
    source,
    undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev: { status: t.status, archivedAt: null } },
  })
  return { message, activityId: ev?.id }
}
