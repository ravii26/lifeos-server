import type { Request, Response } from "express"
import { getDecisionsService } from "./decisions.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"

export const getDecisionsController = async (req: Request, res: Response) => {
  const result = await getDecisionsService(req.user!.id)
  sendSuccess(res, "Decisions generated", result)
}
