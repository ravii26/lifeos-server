import type { Request, Response } from "express"
import { registerService, loginService, getMeService, getStatsService } from "./auth.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { env } from "../../config/env.config.js"
import { isAdminEmail } from "../admin/admin.rules.js"
import { exportAccountService, deleteAccountService } from "./account.service.js"

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
  // The web app shows the admin page link only to admins (the API checks again).
  sendSuccess(res, "Success", { ...user, isAdmin: isAdminEmail(user.email, env.ADMIN_EMAILS) })
}

export const statsController = async (req: Request, res: Response) => {
  const stats = await getStatsService(req.user!.id)
  sendSuccess(res, "Stats fetched", stats)
}

export const exportController = async (req: Request, res: Response) => {
  const data = await exportAccountService(req.user!.id)
  res.setHeader("Content-Disposition", `attachment; filename="ally-export-${new Date().toISOString().slice(0, 10)}.json"`)
  sendSuccess(res, "Your data", data)
}

// Deleting is permanent, so the client must send the word explicitly.
export const deleteAccountController = async (req: Request, res: Response) => {
  if ((req.body as { confirm?: unknown })?.confirm !== "DELETE") throw new ValidationError('Send {"confirm":"DELETE"} to delete the account')
  await deleteAccountService(req.user!.id)
  sendSuccess(res, "Account deleted")
}
