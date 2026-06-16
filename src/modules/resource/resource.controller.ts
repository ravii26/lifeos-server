import type { Request, Response } from "express"
import {
  createResourceService,
  listResourcesService,
  getResourceService,
  updateResourceService,
  deleteResourceService,
} from "./resource.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListResourcesDto } from "./resource.schema.js"

export const createResourceController = async (req: Request, res: Response) => {
  const resource = await createResourceService(req.user!.id, req.body)
  sendSuccess(res, "Resource created", resource, HttpStatus.CREATED)
}

export const listResourcesController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListResourcesDto
  const resources = await listResourcesService(req.user!.id, filters)
  sendSuccess(res, "Resources fetched", resources)
}

export const getResourceController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const resource = await getResourceService(id, req.user!.id)
  sendSuccess(res, "Resource fetched", resource)
}

export const updateResourceController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const resource = await updateResourceService(id, req.user!.id, req.body)
  sendSuccess(res, "Resource updated", resource)
}

export const deleteResourceController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteResourceService(id, req.user!.id)
  sendSuccess(res, "Resource deleted")
}
