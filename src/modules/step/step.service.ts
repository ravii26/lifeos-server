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

const iso = (d: Date | null) => (d ? d.toISOString() : null)

const ownedOpenStep = async (userId: string, id: string) => {
  const t = await prisma.task.findFirst({
    where: { id, userId, archivedAt: null },
    select: { id: true, title: true, sizeMinutes: true, energy: true, minimumVersion: true, dueDate: true, status: true },
  })
  if (!t) throw new NotFoundError("Step not found")
  return t
}

export const addStepService = async (
  userId: string,
  input: { areaId: string; title: string } & StepEdit,
  source: ActivitySource = "APP",
) => {
  const title = input.title.trim()
  if (!title) throw new ValidationError("Give the step a name.")
  // createTaskService checks the area belongs to this person and records an undoable "created".
  const t = await createTaskService(
    userId,
    {
      areaId: input.areaId,
      title,
      sizeMinutes: input.sizeMinutes ?? undefined,
      energy: input.energy ?? undefined,
      minimumVersion: input.minimumVersion?.trim() || undefined,
    },
    { source },
  )
  return { id: t.id, message: `${title} added.`, activityId: t.activityId }
}

export const editStepService = async (userId: string, id: string, edit: StepEdit, source: ActivitySource = "APP") => {
  const t = await ownedOpenStep(userId, id)
  const { data, prev } = diffEdit(t, edit)
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
  await prisma.task.update({ where: { id: t.id }, data: { dueDate: dateFromKey(key) } })
  const message = `${t.title} moved to ${moveWords(move)}.`
  // The hold keeps it out of suggestions until that day, like "Not now".
  const ev = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "TASK",
    itemId: t.id,
    title: message,
    reason: holdReason(key),
    source,
    undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev: { dueDate: iso(t.dueDate) } },
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
