import type { Request, Response } from "express"
import {
  startFocusService,
  stopFocusService,
  listFocusService,
  getFocusService,
  updateFocusService,
  deleteFocusService,
  dailyFocusService,
} from "./focus.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListFocusDto, DailyFocusDto } from "./focus.schema.js"

export const startFocusController = async (req: Request, res: Response) => {
  const session = await startFocusService(req.user!.id, req.body)
  sendSuccess(res, "Focus session started", session, HttpStatus.CREATED)
}

export const stopFocusController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const session = await stopFocusService(id, req.user!.id)
  sendSuccess(res, "Focus session stopped", session)
}

export const listFocusController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListFocusDto
  const sessions = await listFocusService(req.user!.id, filters)
  sendSuccess(res, "Focus sessions fetched", sessions)
}

export const dailyFocusController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as DailyFocusDto
  const days = await dailyFocusService(req.user!.id, filters)
  sendSuccess(res, "Daily focus fetched", days)
}

export const getFocusController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const session = await getFocusService(id, req.user!.id)
  sendSuccess(res, "Focus session fetched", session)
}

export const updateFocusController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const session = await updateFocusService(id, req.user!.id, req.body)
  sendSuccess(res, "Focus session updated", session)
}

export const deleteFocusController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteFocusService(id, req.user!.id)
  sendSuccess(res, "Focus session deleted")
}
