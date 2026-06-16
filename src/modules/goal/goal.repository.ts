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
