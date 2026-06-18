import type { Request, Response } from "express"
import { getGraphService } from "./graph.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"

export const getGraphController = async (req: Request, res: Response) => {
  const graph = await getGraphService(req.user!.id)
  sendSuccess(res, "Knowledge graph fetched", graph)
}
