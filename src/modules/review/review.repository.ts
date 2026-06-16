import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

// --- Review ---
export const createReview = (data: Prisma.ReviewUncheckedCreateInput) => {
  return prisma.review.create({ data })
}

export const findReviewsByUser = (userId: string, filters: Prisma.ReviewWhereInput = {}) => {
  return prisma.review.findMany({
    where: { userId, ...filters },
    orderBy: { periodStart: "desc" },
  })
}

export const findReviewById = (id: string, userId: string) => {
  return prisma.review.findFirst({ where: { id, userId } })
}

export const updateReview = (id: string, data: Prisma.ReviewUpdateInput) => {
  return prisma.review.update({ where: { id }, data })
}

export const deleteReview = (id: string) => {
  return prisma.review.delete({ where: { id } })
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

export const updateInsight = (id: string, data: Prisma.InsightReviewUpdateInput) => {
  return prisma.insightReview.update({ where: { id }, data })
}

export const deleteInsight = (id: string) => {
  return prisma.insightReview.delete({ where: { id } })
}
