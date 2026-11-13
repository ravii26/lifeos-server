import type { Request, Response } from "express"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { getSeasonService, startSeasonService, moveAreaService } from "./season.service.js"
import type { StartSeasonDto, MoveAreaDto } from "./season.schema.js"

export const getSeasonController = async (req: Request, res: Response) => {
  sendSuccess(res, "Season", await getSeasonService(req.user!.id))
}

export const startSeasonController = async (req: Request, res: Response) => {
  sendSuccess(res, "Season started", await startSeasonService(req.user!.id, req.body as StartSeasonDto), 201)
}

// 200 either way: a full place is a normal answer ("which one makes room?"), not an error.
export const moveAreaController = async (req: Request, res: Response) => {
  const result = await moveAreaService(req.user!.id, String(req.params.id), req.body as MoveAreaDto)
  sendSuccess(res, result.moved ? "Area moved" : "That place is full", result)
}
