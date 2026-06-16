import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createNotebook = (data: Prisma.NotebookUncheckedCreateInput) => {
  return prisma.notebook.create({ data })
}

export const findNotebooksByUser = (userId: string, filters: Prisma.NotebookWhereInput = {}) => {
  return prisma.notebook.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
  })
}

export const findNotebookById = (id: string, userId: string) => {
  return prisma.notebook.findFirst({ where: { id, userId } })
}

export const updateNotebook = (id: string, data: Prisma.NotebookUpdateInput) => {
  return prisma.notebook.update({ where: { id }, data })
}

export const deleteNotebook = (id: string) => {
  return prisma.notebook.delete({ where: { id } })
}
