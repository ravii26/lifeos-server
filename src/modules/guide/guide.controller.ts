import type { Request, Response } from "express"
import {
  getTonightService,
  swapTonightService,
  respondTonightService,
  historyService,
  nextService,
} from "./guide.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { createSaveService, decideSaveService } from "./guide.saves.service.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import type { HistoryQueryDto } from "./guide.schema.js"

export const getTonightController = async (req: Request, res: Response) => {
  sendSuccess(res, "Tonight's one thing", await getTonightService(req.user!.id))
}

export const swapTonightController = async (req: Request, res: Response) => {
  sendSuccess(res, "Swapped", await swapTonightService(req.user!.id))
}

export const respondTonightController = async (req: Request, res: Response) => {
  const source = req.body?.source === "NOTIFICATION" ? "NOTIFICATION" : "APP"
  sendSuccess(res, "Answered", await respondTonightService(req.user!.id, req.body, { source }))
}

export const historyController = async (req: Request, res: Response) => {
  const { days } = (res.locals.query ?? {}) as HistoryQueryDto
  sendSuccess(res, "Guide history", await historyService(req.user!.id, days ?? 14))
}

export const nextController = async (req: Request, res: Response) => {
  sendSuccess(res, "One more", await nextService(req.user!.id))
}

// POST /guide/saves — a link, text, or screenshot → one proposed action.
export const createSaveController = async (req: Request, res: Response) => {
  const text = (req.body?.text as string | undefined)?.trim() || undefined
  const file = req.file
  if (!text && !file) throw new ValidationError("Share a link, some text, or a screenshot")
  if (file && !file.mimetype.startsWith("image/")) throw new ValidationError("Screenshots must be images")
  const save = await createSaveService(req.user!.id, {
    text,
    file: file ? { buffer: file.buffer, mimeType: file.mimetype } : undefined,
  })
  sendSuccess(res, "Save read", save, HttpStatus.CREATED)
}

export const decideSaveController = async (req: Request, res: Response) => {
  sendSuccess(res, "Decided", await decideSaveService(req.user!.id, String(req.params.id), req.body))
}
