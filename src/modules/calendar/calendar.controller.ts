import type { Request, Response } from "express"
import {
  createBlockService,
  listBlocksService,
  getBlockService,
  updateBlockService,
  deleteBlockService,
  upsertExceptionService,
  deleteExceptionService,
  splitSeriesService,
} from "./calendar.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import type { ListBlocksDto } from "./calendar.schema.js"

export const createBlockController = async (req: Request, res: Response) => {
  const block = await createBlockService(req.user!.id, req.body)
  sendSuccess(res, "Calendar block created", block, HttpStatus.CREATED)
}

export const listBlocksController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListBlocksDto
  const blocks = await listBlocksService(req.user!.id, filters)
  sendSuccess(res, "Calendar blocks fetched", blocks)
}

export const getBlockController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const block = await getBlockService(id, req.user!.id)
  sendSuccess(res, "Calendar block fetched", block)
}

export const updateBlockController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const block = await updateBlockService(id, req.user!.id, req.body)
  sendSuccess(res, "Calendar block updated", block)
}

export const deleteBlockController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteBlockService(id, req.user!.id)
  sendSuccess(res, "Calendar block deleted")
}

// Create/update a single occurrence override (move, rename, or skip one instance).
export const upsertExceptionController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const exception = await upsertExceptionService(id, req.user!.id, req.body)
  sendSuccess(res, "Occurrence override saved", exception)
}

// Remove an override so the occurrence reverts to the series default.
export const deleteExceptionController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const raw = req.query.occurrenceDate
  if (typeof raw !== "string") {
    throw new ValidationError("occurrenceDate query parameter is required")
  }
  const occurrenceDate = new Date(raw)
  if (Number.isNaN(occurrenceDate.getTime())) {
    throw new ValidationError("occurrenceDate must be a valid date")
  }
  await deleteExceptionService(id, req.user!.id, occurrenceDate)
  sendSuccess(res, "Occurrence override removed")
}

// "This and following": split the series, returning the capped original + new series.
export const splitSeriesController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const result = await splitSeriesService(id, req.user!.id, req.body)
  sendSuccess(res, "Series split", result, HttpStatus.CREATED)
}
