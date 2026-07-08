import type { Request, Response } from "express"
import {
  createAreaService,
  listAreasService,
  getAreaService,
  updateAreaService,
  deleteAreaService,
  snapshotAreaScoreService,
  listAreaSnapshotsService,
  getAreaTrendsService,
} from "./area.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListAreasDto, ListAreaSnapshotsDto } from "./area.schema.js"

export const createAreaController = async (req: Request, res: Response) => {
  const area = await createAreaService(req.user!.id, req.body)
  sendSuccess(res, "Area created", area, HttpStatus.CREATED)
}

export const listAreasController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListAreasDto
  const areas = await listAreasService(req.user!.id, filters)
  sendSuccess(res, "Areas fetched", areas)
}

export const getAreaController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const area = await getAreaService(id, req.user!.id)
  sendSuccess(res, "Area fetched", area)
}

export const updateAreaController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const area = await updateAreaService(id, req.user!.id, req.body)
  sendSuccess(res, "Area updated", area)
}

export const deleteAreaController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteAreaService(id, req.user!.id)
  sendSuccess(res, "Area deleted")
}

export const snapshotAreaScoreController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const snapshot = await snapshotAreaScoreService(id, req.user!.id)
  sendSuccess(res, "Score snapshot saved", snapshot, HttpStatus.CREATED)
}

export const listAreaSnapshotsController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const { limit } = (res.locals.query ?? {}) as ListAreaSnapshotsDto
  const snapshots = await listAreaSnapshotsService(id, req.user!.id, limit ?? 30)
  sendSuccess(res, "Score history fetched", snapshots)
}

export const getAreaTrendsController = async (req: Request, res: Response) => {
  const trends = await getAreaTrendsService(req.user!.id)
  sendSuccess(res, "Area trends fetched", trends)
}
