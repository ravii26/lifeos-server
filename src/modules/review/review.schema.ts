import { z } from "zod"

const reviewType = z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"])
const insightStatus = z.enum(["PENDING", "IMPLEMENTED", "STILL_WORKING", "NOT_APPLICABLE"])

export const createReviewSchema = z.object({
  reviewType: reviewType,
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  summary: z.string().max(5000).optional(),
  highlights: z.string().max(5000).optional(),
  improvements: z.string().max(5000).optional(),
  userNote: z.string().max(5000).optional(),
})

export const updateReviewSchema = z.object({
  reviewType: reviewType.optional(),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
  summary: z.string().max(5000).nullable().optional(),
  highlights: z.string().max(5000).nullable().optional(),
  improvements: z.string().max(5000).nullable().optional(),
  userNote: z.string().max(5000).nullable().optional(),
})

export const listReviewsSchema = z.object({
  reviewType: reviewType.optional(),
})

// InsightReview — links a Note that was acted on, tracked over time.
export const createInsightSchema = z.object({
  noteId: z.string().min(1, "noteId is required"),
  status: insightStatus.optional(),
  userNote: z.string().max(2000).optional(),
})

export const updateInsightSchema = z.object({
  status: insightStatus.optional(),
  userNote: z.string().max(2000).nullable().optional(),
})

export type CreateReviewDto = z.infer<typeof createReviewSchema>
export type UpdateReviewDto = z.infer<typeof updateReviewSchema>
export type ListReviewsDto = z.infer<typeof listReviewsSchema>
export type CreateInsightDto = z.infer<typeof createInsightSchema>
export type UpdateInsightDto = z.infer<typeof updateInsightSchema>
