import { NotFoundError } from "../../shared/utils/errors.util.js"
import { findNoteById } from "../note/note.repository.js"
import {
  createReview,
  findReviewsByUser,
  findReviewById,
  updateReview,
  deleteReview,
  createInsight,
  findInsightsByReview,
  findInsightById,
  updateInsight,
  deleteInsight,
} from "./review.repository.js"
import type {
  CreateReviewDto,
  UpdateReviewDto,
  ListReviewsDto,
  CreateInsightDto,
  UpdateInsightDto,
} from "./review.schema.js"
import type { ReviewDto, InsightReviewDto } from "./review.dto.js"

const getOwnedReview = async (id: string, userId: string) => {
  const review = await findReviewById(id, userId)
  if (!review) throw new NotFoundError("Review not found")
  return review
}

const getOwnedInsight = async (id: string, userId: string) => {
  const insight = await findInsightById(id, userId)
  if (!insight) throw new NotFoundError("Insight not found")
  return insight
}

// --- Review ---
export const createReviewService = (
  userId: string,
  input: CreateReviewDto,
): Promise<ReviewDto> => {
  return createReview({
    userId,
    reviewType: input.reviewType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    summary: input.summary ?? null,
    highlights: input.highlights ?? null,
    improvements: input.improvements ?? null,
    userNote: input.userNote ?? null,
  })
}

export const listReviewsService = (
  userId: string,
  filters: ListReviewsDto,
): Promise<ReviewDto[]> => {
  return findReviewsByUser(userId, {
    ...(filters.reviewType && { reviewType: filters.reviewType }),
  })
}

export const getReviewService = (id: string, userId: string): Promise<ReviewDto> => {
  return getOwnedReview(id, userId)
}

export const updateReviewService = async (
  id: string,
  userId: string,
  input: UpdateReviewDto,
): Promise<ReviewDto> => {
  await getOwnedReview(id, userId)
  return updateReview(id, input)
}

export const deleteReviewService = async (id: string, userId: string): Promise<void> => {
  await getOwnedReview(id, userId)
  await deleteReview(id)
}

// --- InsightReview ---
export const createInsightService = async (
  reviewId: string,
  userId: string,
  input: CreateInsightDto,
): Promise<InsightReviewDto> => {
  await getOwnedReview(reviewId, userId)

  const note = await findNoteById(input.noteId, userId)
  if (!note) throw new NotFoundError("Note not found")

  return createInsight({
    userId,
    reviewId,
    noteId: input.noteId,
    status: input.status ?? "PENDING",
    userNote: input.userNote ?? null,
  })
}

export const listInsightsService = async (
  reviewId: string,
  userId: string,
): Promise<InsightReviewDto[]> => {
  await getOwnedReview(reviewId, userId)
  return findInsightsByReview(reviewId)
}

export const updateInsightService = async (
  id: string,
  userId: string,
  input: UpdateInsightDto,
): Promise<InsightReviewDto> => {
  await getOwnedInsight(id, userId)
  return updateInsight(id, input)
}

export const deleteInsightService = async (id: string, userId: string): Promise<void> => {
  await getOwnedInsight(id, userId)
  await deleteInsight(id)
}
