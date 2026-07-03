import type { Request, Response } from "express"
import {
  createCaptureService,
  listCapturesService,
  updateCaptureTypeService,
  convertCaptureService,
  deleteCaptureService,
} from "./capture.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { env } from "../../config/env.config.js"
import type { ListCapturesDto } from "./capture.schema.js"

// Absolute origin used to build public media URLs. Prefers PUBLIC_BASE_URL,
// otherwise derives from the request (works behind the trust-proxy hop).
const resolveBaseUrl = (req: Request): string =>
  env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get("host")}`

export const createCaptureController = async (req: Request, res: Response) => {
  const file = req.file // populated by uploadCaptureMedia for multipart requests
  const text = (req.body?.text as string | undefined)?.trim() || undefined

  if (!text && !file) {
    throw new ValidationError("Provide text or a media file to capture")
  }

  const capture = await createCaptureService(req.user!.id, {
    text,
    file: file ? { buffer: file.buffer, mimeType: file.mimetype } : undefined,
    baseUrl: resolveBaseUrl(req),
  })
  sendSuccess(res, "Capture created", capture, HttpStatus.CREATED)
}

export const listCapturesController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListCapturesDto
  const captures = await listCapturesService(req.user!.id, filters)
  sendSuccess(res, "Captures fetched", captures)
}

export const updateCaptureController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const capture = await updateCaptureTypeService(id, req.user!.id, req.body)
  sendSuccess(res, "Capture updated", capture)
}

export const convertCaptureController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const result = await convertCaptureService(id, req.user!.id, req.body)
  sendSuccess(res, "Capture converted", result, HttpStatus.CREATED)
}

export const deleteCaptureController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteCaptureService(id, req.user!.id)
  sendSuccess(res, "Capture deleted")
}
