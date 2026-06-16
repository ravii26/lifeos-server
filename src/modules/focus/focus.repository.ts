import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createSession = (data: Prisma.FocusSessionUncheckedCreateInput) => {
  return prisma.focusSession.create({ data })
}

export const findSessionsByUser = (
  userId: string,
  filters: Prisma.FocusSessionWhereInput = {},
) => {
  return prisma.focusSession.findMany({
    where: { userId, ...filters },
    orderBy: { startedAt: "desc" },
  })
}

export const findSessionById = (id: string, userId: string) => {
  return prisma.focusSession.findFirst({ where: { id, userId } })
}

export const updateSession = (id: string, data: Prisma.FocusSessionUpdateInput) => {
  return prisma.focusSession.update({ where: { id }, data })
}

export const deleteSession = (id: string) => {
  return prisma.focusSession.delete({ where: { id } })
}
