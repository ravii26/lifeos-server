import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

// --- Review ---
export const createReview = (data: Prisma.ReviewUncheckedCreateInput) => {
  return prisma.review.create({ data })
}

export const findReviewsByUser = (
  userId: string,
  filters: Prisma.ReviewWhereInput = {},
  skip?: number,
  take?: number,
) => {
  return prisma.review.findMany({
    where: { userId, ...filters },
    orderBy: { periodStart: "desc" },
    skip,
    take,
  })
}

export const countReviewsByUser = (userId: string, filters: Prisma.ReviewWhereInput = {}) => {
  return prisma.review.count({ where: { userId, ...filters } })
}

export const findReviewById = (id: string, userId: string) => {
  return prisma.review.findFirst({ where: { id, userId } })
}

export const updateReview = (id: string, userId: string, data: Prisma.ReviewUpdateInput) => {
  return prisma.review.updateMany({ where: { id, userId }, data })
}

export const deleteReview = (id: string, userId: string) => {
  return prisma.review.deleteMany({ where: { id, userId } })
}

// Factual activity in a [start, end] window — the raw material for an
// auto-drafted review. Counts are exact; titles are a small sample.
export const findReviewPeriodStats = async (userId: string, start: Date, end: Date) => {
  const [tasksCompleted, taskTitles, habitsLogged, focus] = await Promise.all([
    prisma.task.count({
      where: { userId, status: "COMPLETED", completedAt: { gte: start, lte: end } },
    }),
    prisma.task.findMany({
      where: { userId, status: "COMPLETED", completedAt: { gte: start, lte: end } },
      select: { title: true },
      orderBy: { completedAt: "desc" },
      take: 5,
    }),
    prisma.habitLog.count({
      where: { userId, completed: true, date: { gte: start, lte: end } },
    }),
    prisma.focusSession.aggregate({
      where: { userId, startedAt: { gte: start, lte: end } },
      _sum: { durationMinutes: true },
    }),
  ])
  return {
    tasksCompleted,
    taskTitles: taskTitles.map((t) => t.title),
    habitsLogged,
    focusMinutes: focus._sum.durationMinutes ?? 0,
  }
}

// --- InsightReview ---
export const createInsight = (data: Prisma.InsightReviewUncheckedCreateInput) => {
  return prisma.insightReview.create({ data })
}

export const findInsightsByReview = (reviewId: string) => {
  return prisma.insightReview.findMany({
    where: { reviewId },
    orderBy: { createdAt: "desc" },
  })
}

export const findInsightById = (id: string, userId: string) => {
  return prisma.insightReview.findFirst({ where: { id, userId } })
}

export const updateInsight = (
  id: string,
  userId: string,
  data: Prisma.InsightReviewUpdateInput,
) => {
  return prisma.insightReview.updateMany({ where: { id, userId }, data })
}

export const deleteInsight = (id: string, userId: string) => {
  return prisma.insightReview.deleteMany({ where: { id, userId } })
}
