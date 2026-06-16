import type { Request, Response } from "express"
import {
  createReviewService,
  listReviewsService,
  getReviewService,
  updateReviewService,
  deleteReviewService,
  createInsightService,
  listInsightsService,
  updateInsightService,
  deleteInsightService,
} from "./review.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListReviewsDto } from "./review.schema.js"

// --- Review ---
export const createReviewController = async (req: Request, res: Response) => {
  const review = await createReviewService(req.user!.id, req.body)
  sendSuccess(res, "Review created", review, HttpStatus.CREATED)
}

export const listReviewsController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListReviewsDto
  const reviews = await listReviewsService(req.user!.id, filters)
  sendSuccess(res, "Reviews fetched", reviews)
}

export const getReviewController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const review = await getReviewService(id, req.user!.id)
  sendSuccess(res, "Review fetched", review)
}

export const updateReviewController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const review = await updateReviewService(id, req.user!.id, req.body)
  sendSuccess(res, "Review updated", review)
}

export const deleteReviewController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteReviewService(id, req.user!.id)
  sendSuccess(res, "Review deleted")
}

// --- InsightReview ---
export const createInsightController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const insight = await createInsightService(id, req.user!.id, req.body)
  sendSuccess(res, "Insight added", insight, HttpStatus.CREATED)
}

export const listInsightsController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const insights = await listInsightsService(id, req.user!.id)
  sendSuccess(res, "Insights fetched", insights)
}

export const updateInsightController = async (req: Request, res: Response) => {
  const { insightId } = req.params as { insightId: string }
  const insight = await updateInsightService(insightId, req.user!.id, req.body)
  sendSuccess(res, "Insight updated", insight)
}

export const deleteInsightController = async (req: Request, res: Response) => {
  const { insightId } = req.params as { insightId: string }
  await deleteInsightService(insightId, req.user!.id)
  sendSuccess(res, "Insight deleted")
}
