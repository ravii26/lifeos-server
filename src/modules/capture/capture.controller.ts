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
import type { ListCapturesDto } from "./capture.schema.js"

export const createCaptureController = async (req: Request, res: Response) => {
  const capture = await createCaptureService(req.user!.id, req.body)
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
