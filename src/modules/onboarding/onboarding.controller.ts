import type { Request, Response } from "express"
import { extractOnboardingService } from "./onboarding.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import type { ExtractOnboardingDto } from "./onboarding.schema.js"

export const extractOnboardingController = async (req: Request, res: Response) => {
  const { text } = req.body as ExtractOnboardingDto
  const result = await extractOnboardingService(req.user!.id, text)
  sendSuccess(res, "Starter setup generated", result)
}
