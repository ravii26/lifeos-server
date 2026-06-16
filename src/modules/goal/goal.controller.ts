import type { Request, Response } from "express"
import {
  createGoalService,
  listGoalsService,
  getGoalService,
  updateGoalService,
  deleteGoalService,
} from "./goal.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListGoalsDto } from "./goal.schema.js"

export const createGoalController = async (req: Request, res: Response) => {
  const goal = await createGoalService(req.user!.id, req.body)
  sendSuccess(res, "Goal created", goal, HttpStatus.CREATED)
}

export const listGoalsController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListGoalsDto
  const goals = await listGoalsService(req.user!.id, filters)
  sendSuccess(res, "Goals fetched", goals)
}

export const getGoalController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const goal = await getGoalService(id, req.user!.id)
  sendSuccess(res, "Goal fetched", goal)
}

export const updateGoalController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const goal = await updateGoalService(id, req.user!.id, req.body)
  sendSuccess(res, "Goal updated", goal)
}

export const deleteGoalController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteGoalService(id, req.user!.id)
  sendSuccess(res, "Goal deleted")
}
