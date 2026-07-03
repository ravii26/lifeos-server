import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createTask = (data: Prisma.TaskUncheckedCreateInput) => {
  return prisma.task.create({ data })
}

export const findTasksByUser = (
  userId: string,
  filters: Prisma.TaskWhereInput = {},
  skip?: number,
  take?: number,
) => {
  return prisma.task.findMany({
    where: { userId, ...filters },
    orderBy: [{ createdAt: "desc" }],
    skip,
    take,
  })
}

export const countTasksByUser = (userId: string, filters: Prisma.TaskWhereInput = {}) => {
  return prisma.task.count({ where: { userId, ...filters } })
}

export const findTaskById = (id: string, userId: string) => {
  return prisma.task.findFirst({ where: { id, userId } })
}

export const updateTask = (id: string, userId: string, data: Prisma.TaskUpdateInput) => {
  return prisma.task.updateMany({ where: { id, userId }, data })
}

export const deleteTask = (id: string, userId: string) => {
  return prisma.task.deleteMany({ where: { id, userId } })
}
