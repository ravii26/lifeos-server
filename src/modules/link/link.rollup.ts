import prisma from "../../lib/prisma.js"
import { findResourceById, updateResource } from "../resource/resource.repository.js"

/**
 * Progress roll-up for ADVANCES links (phase 3).
 *
 * The ONLY roll-up target is Resource: it carries a real `lessonsCompleted`
 * counter, and an ADVANCES link from a Task is the signal that completing that
 * task moved the resource forward. (Goals already derive progress from the
 * spine + confidence; Topics/Notes have no numeric progress — so neither rolls
 * up here.)
 *
 * The invariant we preserve everywhere: a Resource's lessonsCompleted reflects
 * the sum of weights of its COMPLETED advancing tasks. Every event that could
 * change that sum — task complete/uncomplete/delete, link add/remove — applies
 * a signed delta, clamped to [0, totalLessons].
 */

// Apply a signed lesson delta to one resource, clamped to valid bounds.
const adjustResource = async (userId: string, resourceId: string, delta: number) => {
  if (delta === 0) return
  const resource = await findResourceById(resourceId, userId)
  if (!resource) return // link outlived its target — nothing to move
  let next = resource.lessonsCompleted + delta
  if (next < 0) next = 0
  if (resource.totalLessons != null && next > resource.totalLessons) {
    next = resource.totalLessons
  }
  if (next !== resource.lessonsCompleted) {
    await updateResource(resourceId, userId, { lessonsCompleted: next })
  }
}

// Roll every ADVANCES Task→Resource link of this task up (+1) or down (-1).
// Called when the task crosses the COMPLETED boundary.
export const rollupTaskAdvances = async (
  userId: string,
  taskId: string,
  sign: 1 | -1,
) => {
  const links = await prisma.entityLink.findMany({
    where: {
      userId,
      fromType: "TASK",
      fromId: taskId,
      toType: "RESOURCE",
      role: "ADVANCES",
    },
  })
  for (const link of links) {
    await adjustResource(userId, link.toId, sign * (link.weight ?? 1))
  }
}

// A single link was just created (+1) or removed (-1). Only matters if it's an
// ADVANCES Task→Resource link AND its task is already COMPLETED — otherwise the
// task-status path will (or already did) account for it.
export const rollupLinkIfTaskDone = async (
  userId: string,
  link: {
    fromType: string
    fromId: string
    toType: string
    toId: string
    role: string
    weight: number | null
  },
  sign: 1 | -1,
) => {
  if (link.role !== "ADVANCES" || link.fromType !== "TASK" || link.toType !== "RESOURCE") {
    return
  }
  const task = await prisma.task.findFirst({
    where: { id: link.fromId, userId },
    select: { status: true },
  })
  if (task?.status !== "COMPLETED") return
  await adjustResource(userId, link.toId, sign * (link.weight ?? 1))
}
