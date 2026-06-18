import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createArea = (data: Prisma.AreaUncheckedCreateInput) => {
  return prisma.area.create({ data })
}

export const findAreasByUser = (userId: string) => {
  return prisma.area.findMany({
    where: { userId },
    orderBy: { order: "asc" },
  })
}

export const findAreaById = (id: string, userId: string) => {
  return prisma.area.findFirst({ where: { id, userId } })
}

export const updateArea = (id: string, data: Prisma.AreaUpdateInput) => {
  return prisma.area.update({ where: { id }, data })
}

export const deleteArea = (id: string) => {
  return prisma.area.delete({ where: { id } })
}

// ---- scoring data (A2) ---------------------------------------------
// Fetched in three flat queries (no N+1), then blended in the service.

export const findTasksForScoring = (userId: string) => {
  return prisma.task.findMany({
    where: { userId },
    select: { areaId: true, status: true },
  })
}

export const findHabitsWithLogsForScoring = (userId: string, since: Date) => {
  return prisma.habit.findMany({
    where: { userId },
    select: {
      areaId: true,
      logs: {
        where: { date: { gte: since } },
        select: { date: true, completed: true, minutes: true },
      },
    },
  })
}

export const findResourcesForScoring = (userId: string) => {
  return prisma.resource.findMany({
    where: { userId },
    select: { status: true, topic: { select: { areaId: true } } },
  })
}

// ---- score snapshots (A3) --------------------------------------------------

export const createScoreSnapshot = (data: {
  userId: string
  areaId: string
  score: number
  tasksDone: number
  tasksTotal: number
  streak: number
  focusMins: number
}) => {
  return prisma.areaScoreSnapshot.create({ data })
}

export const findScoreSnapshots = (areaId: string, userId: string, limit = 30) => {
  return prisma.areaScoreSnapshot.findMany({
    where: { areaId, userId },
    orderBy: { snapshotAt: "desc" },
    take: limit,
  })
}

export const getMaxOrder = async (userId: string): Promise<number> => {
  const result = await prisma.area.aggregate({
    where: { userId },
    _max: { order: true },
  })
  return result._max.order ?? -1
}

// ---- trends (last N snapshots for all areas owned by user) ----------------

export const findAllAreaSnapshots = (userId: string, perAreaLimit = 7) => {
  return prisma.areaScoreSnapshot.findMany({
    where: { userId },
    orderBy: { snapshotAt: "desc" },
    take: perAreaLimit * 20, // generous cap — grouped in service
  })
}
