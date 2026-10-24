import type { Request, Response } from "express"
import {
  getTonightService,
  swapTonightService,
  respondTonightService,
  historyService,
  nextService,
} from "./guide.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { batchSavesService, decideManyService, savesSummaryService, staleSavesService } from "./saves.batch.service.js"
import { createSaveService, decideSaveService, getSaveService, listMoodsService, markWatchedService, listSavesService, setSaveMoodsService, setSavePurposeService } from "./guide.saves.service.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
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
  if (file && !file.mimetype.startsWith("image/") && file.mimetype !== "application/pdf") throw new ValidationError("Share an image or a PDF")
  const save = await createSaveService(req.user!.id, {
    text,
    file: file ? { buffer: file.buffer, mimeType: file.mimetype } : undefined,
  })
  sendSuccess(res, "Save read", save, HttpStatus.CREATED)
}

// POST /guide/saves/batch — up to 10 shared links at once, triaged together.
export const batchSavesController = async (req: Request, res: Response) => {
  sendSuccess(res, "Saved", await batchSavesService(req.user!.id, req.body.items), 201)
}

// POST /guide/saves/decide-many — put several undecided saves in Watch later, or let them go.
export const decideManySavesController = async (req: Request, res: Response) => {
  const count = await decideManyService(req.user!.id, req.body.ids, req.body.choice)
  sendSuccess(res, "Decided", { count })
}

// GET /guide/saves/summary?days=7 — saved, acted on, waiting, and the ones undecided for a month.
export const savesSummaryController = async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7))
  const [counts, stale] = await Promise.all([savesSummaryService(req.user!.id, days), staleSavesService(req.user!.id)])
  sendSuccess(res, "Saves", { days, counts, stale: stale.map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt })) })
}

// POST /guide/saves/:id/watched — "I watched it": it leaves Watch later.
export const watchedSaveController = async (req: Request, res: Response) => {
  const ok = await markWatchedService(req.user!.id, String(req.params.id))
  if (!ok) throw new NotFoundError("That save is not in your watch later")
  sendSuccess(res, "Watched", { id: String(req.params.id) })
}

export const decideSaveController = async (req: Request, res: Response) => {
  sendSuccess(res, "Decided", await decideSaveService(req.user!.id, String(req.params.id), req.body))
}

// GET /guide/saves/:id — the save as it is now (the video summary arrives after a few seconds).
export const getSaveController = async (req: Request, res: Response) => {
  sendSuccess(res, "Save", await getSaveService(req.user!.id, String(req.params.id)))
}

// POST /guide/saves/:id/purpose — one tap to correct learning ↔ feeling.
export const setSavePurposeController = async (req: Request, res: Response) => {
  sendSuccess(res, "Save updated", await setSavePurposeService(req.user!.id, String(req.params.id), req.body.purpose))
}

// GET /guide/saves/moods — common moods, and the ones this person made up.
export const listMoodsController = async (req: Request, res: Response) => {
  sendSuccess(res, "Moods", await listMoodsService(req.user!.id))
}

// POST /guide/saves/:id/moods — bring this save back when they feel this way.
export const setSaveMoodsController = async (req: Request, res: Response) => {
  sendSuccess(res, "Save updated", await setSaveMoodsService(req.user!.id, String(req.params.id), req.body.moods))
}

// GET /guide/saves — saves waiting for a decision, and the ones kept on the shelf.
export const listSavesController = async (req: Request, res: Response) => {
  sendSuccess(res, "Saves", await listSavesService(req.user!.id))
}
