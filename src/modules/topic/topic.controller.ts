import type { Request, Response } from "express"
import {
  createTopicService,
  listTopicsService,
  getTopicService,
  updateTopicService,
  deleteTopicService,
} from "./topic.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListTopicsDto } from "./topic.schema.js"

export const createTopicController = async (req: Request, res: Response) => {
  const topic = await createTopicService(req.user!.id, req.body)
  sendSuccess(res, "Topic created", topic, HttpStatus.CREATED)
}

export const listTopicsController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListTopicsDto
  const topics = await listTopicsService(req.user!.id, filters)
  sendSuccess(res, "Topics fetched", topics)
}

export const getTopicController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const topic = await getTopicService(id, req.user!.id)
  sendSuccess(res, "Topic fetched", topic)
}

export const updateTopicController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const topic = await updateTopicService(id, req.user!.id, req.body)
  sendSuccess(res, "Topic updated", topic)
}

export const deleteTopicController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteTopicService(id, req.user!.id)
  sendSuccess(res, "Topic deleted")
}
