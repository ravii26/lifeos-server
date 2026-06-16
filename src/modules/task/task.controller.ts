import type { Request, Response } from "express"
import {
  createTaskService,
  listTasksService,
  getTaskService,
  updateTaskService,
  completeTaskService,
  deleteTaskService,
} from "./task.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListTasksDto } from "./task.schema.js"

export const createTaskController = async (req: Request, res: Response) => {
  const task = await createTaskService(req.user!.id, req.body)
  sendSuccess(res, "Task created", task, HttpStatus.CREATED)
}

export const listTasksController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListTasksDto
  const tasks = await listTasksService(req.user!.id, filters)
  sendSuccess(res, "Tasks fetched", tasks)
}

export const getTaskController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const task = await getTaskService(id, req.user!.id)
  sendSuccess(res, "Task fetched", task)
}

export const updateTaskController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const task = await updateTaskService(id, req.user!.id, req.body)
  sendSuccess(res, "Task updated", task)
}

export const completeTaskController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const task = await completeTaskService(id, req.user!.id)
  sendSuccess(res, "Task completed", task)
}

export const deleteTaskController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteTaskService(id, req.user!.id)
  sendSuccess(res, "Task deleted")
}
