import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createBehaviorLog = (data: Prisma.BehaviorLogUncheckedCreateInput) => {
  return prisma.behaviorLog.create({ data })
}

export const findBehaviorLogsByUser = (
  userId: string,
  filters: Prisma.BehaviorLogWhereInput = {},
) => {
  return prisma.behaviorLog.findMany({
    where: { userId, ...filters },
    orderBy: { occurredAt: "desc" },
    take: 500,
  })
}
