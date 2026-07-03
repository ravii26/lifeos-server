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

// Sessions that overlap the window [from, to): started before `to` and either
// still running (endedAt null) or ended after `from`. Used by the daily split.
export const findSessionsOverlapping = (
  userId: string,
  from: Date,
  to: Date,
  extra: Prisma.FocusSessionWhereInput = {},
) => {
  return prisma.focusSession.findMany({
    where: {
      userId,
      startedAt: { lt: to },
      OR: [{ endedAt: { gt: from } }, { endedAt: null }],
      ...extra,
    },
    select: { startedAt: true, endedAt: true },
  })
}

export const updateSession = (
  id: string,
  userId: string,
  data: Prisma.FocusSessionUpdateInput,
) => {
  return prisma.focusSession.updateMany({ where: { id, userId }, data })
}

export const deleteSession = (id: string, userId: string) => {
  return prisma.focusSession.deleteMany({ where: { id, userId } })
}
