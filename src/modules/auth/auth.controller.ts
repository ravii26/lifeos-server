import type { Request, Response } from "express"
import { registerService, loginService, getMeService } from "./auth.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"

export const registerController = async (req: Request, res: Response) => {
  const result = await registerService(req.body)
  sendSuccess(res, "Registration successful", result, HttpStatus.CREATED)
}

export const loginController = async (req: Request, res: Response) => {
  const result = await loginService(req.body)
  sendSuccess(res, "Login successful", result)
}

export const meController = async (req: Request, res: Response) => {
  const user = await getMeService(req.user!.id)
  sendSuccess(res, "Success", user)
}
