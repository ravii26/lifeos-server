import type { Request, Response } from "express"
import { recordBehaviorService, listBehaviorService } from "./behavior.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListBehaviorDto } from "./behavior.schema.js"

export const recordBehaviorController = async (req: Request, res: Response) => {
  const log = await recordBehaviorService(req.user!.id, req.body)
  sendSuccess(res, "Behavior recorded", log, HttpStatus.CREATED)
}

export const listBehaviorController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListBehaviorDto
  const logs = await listBehaviorService(req.user!.id, filters)
  sendSuccess(res, "Behavior logs fetched", logs)
}
