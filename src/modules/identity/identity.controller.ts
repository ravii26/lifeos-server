import type { Request, Response } from "express"
import { getIdentityService, upsertIdentityService } from "./identity.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"

export const getIdentityController = async (req: Request, res: Response) => {
  const identity = await getIdentityService(req.user!.id)
  sendSuccess(res, "Identity fetched", identity)
}

export const upsertIdentityController = async (req: Request, res: Response) => {
  const identity = await upsertIdentityService(req.user!.id, req.body)
  sendSuccess(res, "Identity saved", identity)
}
