import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createTask = (data: Prisma.TaskUncheckedCreateInput) => {
  return prisma.task.create({ data })
}

export const findTasksByUser = (userId: string, filters: Prisma.TaskWhereInput = {}) => {
  return prisma.task.findMany({
    where: { userId, ...filters },
    orderBy: [{ createdAt: "desc" }],
  })
}

export const findTaskById = (id: string, userId: string) => {
  return prisma.task.findFirst({ where: { id, userId } })
}

export const updateTask = (id: string, data: Prisma.TaskUpdateInput) => {
  return prisma.task.update({ where: { id }, data })
}

export const deleteTask = (id: string) => {
  return prisma.task.delete({ where: { id } })
}
