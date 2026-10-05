import type { Prisma } from "@prisma/client"
import prisma from "../../lib/prisma.js"

// Everything the nightly pick needs, one query per data type.
export const findGuideContext = async (userId: string, since: Date) => {
  const [user, areas, tasks, habits, recent, identity] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    prisma.area.findMany({
      where: { userId, isActive: true },
      select: { id: true, name: true, tier: true, laterUntil: true },
    }),
    prisma.task.findMany({
      where: { userId, status: { in: ["TODO", "IN_PROGRESS"] } },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "asc" }],
      take: 60,
      select: {
        id: true,
        title: true,
        minimumVersion: true,
        priority: true,
        dueDate: true,
        areaId: true,
        goal: { select: { id: true, title: true, why: true, areaId: true, status: true } },
      },
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        title: true,
        minimumVersion: true,
        areaId: true,
        frequency: true,
        weeklyTarget: true,
        specificDays: true,
        logs: { where: { date: { gte: since }, completed: true }, select: { date: true } },
      },
    }),
    prisma.nightlyCommitment.findMany({
      where: { userId, date: { gte: since } },
      orderBy: { date: "desc" },
      select: { date: true, sourceId: true, status: true, skipReason: true },
    }),
    prisma.identity.findUnique({ where: { userId }, select: { thisYearGoal: true } }),
  ])
  return { timezone: user?.timezone ?? "Asia/Kolkata", areas, tasks, habits, recent, identity }
}

export const findCommitment = (userId: string, date: Date) =>
  prisma.nightlyCommitment.findUnique({ where: { userId_date: { userId, date } } })

export const createCommitment = (data: Prisma.NightlyCommitmentUncheckedCreateInput) =>
  prisma.nightlyCommitment.create({ data })

export const updateCommitment = (id: string, data: Prisma.NightlyCommitmentUpdateInput) =>
  prisma.nightlyCommitment.update({ where: { id }, data })

export const listCommitments = (userId: string, since: Date) =>
  prisma.nightlyCommitment.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: "desc" } })
