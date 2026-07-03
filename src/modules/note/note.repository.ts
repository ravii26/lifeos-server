import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createNote = (data: Prisma.NoteUncheckedCreateInput) => {
  return prisma.note.create({ data })
}

export const findNotesByUser = (
  userId: string,
  filters: Prisma.NoteWhereInput = {},
  skip?: number,
  take?: number,
) => {
  return prisma.note.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  })
}

export const countNotesByUser = (userId: string, filters: Prisma.NoteWhereInput = {}) => {
  return prisma.note.count({ where: { userId, ...filters } })
}

export const findNoteById = (id: string, userId: string) => {
  return prisma.note.findFirst({ where: { id, userId } })
}

export const updateNote = (id: string, userId: string, data: Prisma.NoteUpdateInput) => {
  return prisma.note.updateMany({ where: { id, userId }, data })
}

export const deleteNote = (id: string, userId: string) => {
  return prisma.note.deleteMany({ where: { id, userId } })
}
