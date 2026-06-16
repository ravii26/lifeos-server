import type { Request, Response } from "express"
import {
  createBlockService,
  listBlocksService,
  getBlockService,
  updateBlockService,
  deleteBlockService,
} from "./calendar.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
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
