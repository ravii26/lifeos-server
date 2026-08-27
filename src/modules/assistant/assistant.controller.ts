import type { Request, Response } from "express"
import { assistantAsk } from "./assistant.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"

export const assistantAskController = async (req: Request, res: Response) => {
  const { message, history } = req.body as {
    message?: string
    history?: { role: "user" | "assistant"; text: string }[]
  }
  if (typeof message !== "string") {
    throw new ValidationError("message is required")
  }
  const result = await assistantAsk(req.user!.id, message, history)
  sendSuccess(res, "Assistant reply generated", result)
}
