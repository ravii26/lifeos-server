import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createGoal = (data: Prisma.GoalUncheckedCreateInput) => {
  return prisma.goal.create({ data })
}

export const findGoalsByUser = (userId: string, filters: Prisma.GoalWhereInput = {}) => {
  return prisma.goal.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
  })
}

export const findGoalById = (id: string, userId: string) => {
  return prisma.goal.findFirst({ where: { id, userId } })
}

export const updateGoal = (id: string, data: Prisma.GoalUpdateInput) => {
  return prisma.goal.update({ where: { id }, data })
}

export const deleteGoal = (id: string) => {
  return prisma.goal.delete({ where: { id } })
}

/* --- Focus management (priority cap + parking) --- */

// How many goals the user currently has ACTIVE (the thing we cap).
export const countActiveGoals = (userId: string) => {
  return prisma.goal.count({ where: { userId, status: "ACTIVE" } })
}

// The active goals themselves — returned in the "you're full, pick one to
// park" conflict payload so the frontend can render the chooser directly.
export const findActiveGoals = (userId: string) => {
  return prisma.goal.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { activatedAt: "asc" },
  })
}

// Atomic swap: park one goal and activate another in a single transaction so
// the cap is never momentarily violated.
export const swapActiveGoal = (activateId: string, parkId: string) => {
  const now = new Date()
  return prisma.$transaction([
    prisma.goal.update({
      where: { id: parkId },
      data: { status: "PARKED", parkedAt: now },
    }),
    prisma.goal.update({
      where: { id: activateId },
      data: { status: "ACTIVE", activatedAt: now, parkedAt: null },
    }),
  ])
}

/* --- Confidence scoring data --- */

// One batched pull of everything scoreGoalConfidence needs for a set of goals:
// each goal's directly-linked tasks, and the habits in each goal's area with
// their recent logs. Three flat queries, no N+1.
export const findGoalScoringData = async (
  userId: string,
  goalIds: string[],
  areaIds: string[],
  since: Date,
) => {
  const [tasks, habits] = await Promise.all([
    prisma.task.findMany({
      where: { userId, goalId: { in: goalIds } },
      select: { goalId: true, status: true, completedAt: true },
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true, areaId: { in: areaIds } },
      select: {
        areaId: true,
        logs: {
          where: { date: { gte: since } },
          select: { date: true, completed: true },
        },
      },
    }),
  ])
  return { tasks, habits }
}
