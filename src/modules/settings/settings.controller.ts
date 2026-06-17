import type { Request, Response } from "express"
import { getSettingsService, updateSettingsService } from "./settings.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"

export const getSettingsController = async (req: Request, res: Response) => {
  const settings = await getSettingsService(req.user!.id)
  sendSuccess(res, "Settings fetched", settings)
}

export const updateSettingsController = async (req: Request, res: Response) => {
  const settings = await updateSettingsService(req.user!.id, req.body)
  sendSuccess(res, "Settings updated", settings)
}
