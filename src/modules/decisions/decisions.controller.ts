import type { Request, Response } from "express"
import { getDecisionsService, answerProfilePromptService } from "./decisions.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"

export const getDecisionsController = async (req: Request, res: Response) => {
  const result = await getDecisionsService(req.user!.id)
  sendSuccess(res, "Decisions generated", result)
}

export const answerProfilePromptController = async (req: Request, res: Response) => {
  const { field, value } = req.body as { field?: string; value?: string }
  if (typeof field !== "string" || typeof value !== "string" || !value.trim()) {
    throw new ValidationError("field and a non-empty value are required")
  }
  await answerProfilePromptService(req.user!.id, field, value.trim())
  sendSuccess(res, "Saved")
}
