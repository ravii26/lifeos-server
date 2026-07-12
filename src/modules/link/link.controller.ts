import type { Request, Response } from "express"
import { createLinkService, listLinksService, deleteLinkService } from "./link.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListLinksDto } from "./link.schema.js"

export const createLinkController = async (req: Request, res: Response) => {
  const link = await createLinkService(req.user!.id, req.body)
  sendSuccess(res, "Link created", link, HttpStatus.CREATED)
}

export const listLinksController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListLinksDto
  const links = await listLinksService(req.user!.id, filters)
  sendSuccess(res, "Links fetched", links)
}

export const deleteLinkController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteLinkService(id, req.user!.id)
  sendSuccess(res, "Link deleted")
}
