import type { Request, Response } from "express"
import {
  createVaultItemService,
  listVaultItemsService,
  getVaultItemService,
  updateVaultItemService,
  deleteVaultItemService,
} from "./vault.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListVaultItemsDto } from "./vault.schema.js"

export const createVaultItemController = async (req: Request, res: Response) => {
  const item = await createVaultItemService(req.user!.id, req.body)
  sendSuccess(res, "Vault item created", item, HttpStatus.CREATED)
}

export const listVaultItemsController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListVaultItemsDto
  const items = await listVaultItemsService(req.user!.id, filters)
  sendSuccess(res, "Vault items fetched", items)
}

export const getVaultItemController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const item = await getVaultItemService(id, req.user!.id)
  sendSuccess(res, "Vault item fetched", item)
}

export const updateVaultItemController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const item = await updateVaultItemService(id, req.user!.id, req.body)
  sendSuccess(res, "Vault item updated", item)
}

export const deleteVaultItemController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteVaultItemService(id, req.user!.id)
  sendSuccess(res, "Vault item deleted")
}
