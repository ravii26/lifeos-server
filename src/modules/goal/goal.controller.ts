import type { Request, Response } from "express"
import {
  createGoalService,
  listGoalsService,
  listGoalsWithConfidenceService,
  getGoalBoardService,
  getGoalService,
  getGoalConfidenceService,
  updateGoalService,
  deleteGoalService,
  activateGoalService,
  parkGoalService,
} from "./goal.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListGoalsDto, ActivateGoalDto } from "./goal.schema.js"

export const createGoalController = async (req: Request, res: Response) => {
  const goal = await createGoalService(req.user!.id, req.body)
  sendSuccess(res, "Goal created", goal, HttpStatus.CREATED)
}

export const listGoalsController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListGoalsDto
  const goals = filters.withConfidence
    ? await listGoalsWithConfidenceService(req.user!.id, filters)
    : await listGoalsService(req.user!.id, filters)
  sendSuccess(res, "Goals fetched", goals)
}

export const getGoalBoardController = async (req: Request, res: Response) => {
  const board = await getGoalBoardService(req.user!.id)
  sendSuccess(res, "Goal board fetched", board)
}

export const getGoalController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const goal = await getGoalService(id, req.user!.id)
  sendSuccess(res, "Goal fetched", goal)
}

export const getGoalConfidenceController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const goal = await getGoalConfidenceService(id, req.user!.id)
  sendSuccess(res, "Goal confidence fetched", goal)
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

export const activateGoalController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const { parkGoalId } = req.body as ActivateGoalDto
  const state = await activateGoalService(id, req.user!.id, parkGoalId)
  sendSuccess(res, "Goal activated", state)
}

export const parkGoalController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const state = await parkGoalService(id, req.user!.id)
  sendSuccess(res, "Goal parked", state)
}
