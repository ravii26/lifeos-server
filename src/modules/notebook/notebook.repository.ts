import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createNotebook = (data: Prisma.NotebookUncheckedCreateInput) => {
  return prisma.notebook.create({ data })
}

export const findNotebooksByUser = (
  userId: string,
  filters: Prisma.NotebookWhereInput = {},
  skip?: number,
  take?: number,
) => {
  return prisma.notebook.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  })
}

export const countNotebooksByUser = (userId: string, filters: Prisma.NotebookWhereInput = {}) => {
  return prisma.notebook.count({ where: { userId, ...filters } })
}

export const findNotebookById = (id: string, userId: string) => {
  return prisma.notebook.findFirst({ where: { id, userId } })
}

export const updateNotebook = (
  id: string,
  userId: string,
  data: Prisma.NotebookUpdateInput,
) => {
  return prisma.notebook.updateMany({ where: { id, userId }, data })
}

export const deleteNotebook = (id: string, userId: string) => {
  return prisma.notebook.deleteMany({ where: { id, userId } })
}
