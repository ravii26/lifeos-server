import type { Request, Response } from "express"
import {
  createHabitService,
  listHabitsService,
  getHabitService,
  updateHabitService,
  deleteHabitService,
  logHabitService,
  listHabitLogsService,
} from "./habit.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListHabitsDto, ListLogsDto } from "./habit.schema.js"

export const createHabitController = async (req: Request, res: Response) => {
  const habit = await createHabitService(req.user!.id, req.body)
  sendSuccess(res, "Habit created", habit, HttpStatus.CREATED)
}

export const listHabitsController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListHabitsDto
  const habits = await listHabitsService(req.user!.id, filters)
  sendSuccess(res, "Habits fetched", habits)
}

export const getHabitController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const habit = await getHabitService(id, req.user!.id)
  sendSuccess(res, "Habit fetched", habit)
}

export const updateHabitController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const habit = await updateHabitService(id, req.user!.id, req.body)
  sendSuccess(res, "Habit updated", habit)
}

export const deleteHabitController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteHabitService(id, req.user!.id)
  sendSuccess(res, "Habit deleted")
}

export const logHabitController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const log = await logHabitService(id, req.user!.id, req.body)
  sendSuccess(res, "Habit logged", log, HttpStatus.CREATED)
}

export const listHabitLogsController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const range = (res.locals.query ?? {}) as ListLogsDto
  const logs = await listHabitLogsService(id, req.user!.id, range)
  sendSuccess(res, "Habit logs fetched", logs)
}
