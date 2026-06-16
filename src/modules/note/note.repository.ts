import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createNote = (data: Prisma.NoteUncheckedCreateInput) => {
  return prisma.note.create({ data })
}

export const findNotesByUser = (userId: string, filters: Prisma.NoteWhereInput = {}) => {
  return prisma.note.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
  })
}

export const findNoteById = (id: string, userId: string) => {
  return prisma.note.findFirst({ where: { id, userId } })
}

export const updateNote = (id: string, data: Prisma.NoteUpdateInput) => {
  return prisma.note.update({ where: { id }, data })
}

export const deleteNote = (id: string) => {
  return prisma.note.delete({ where: { id } })
}
