import type { Request, Response } from "express"
import {
  createProjectService,
  listProjectsService,
  getProjectService,
  updateProjectService,
  deleteProjectService,
} from "./project.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListProjectsDto } from "./project.schema.js"

export const createProjectController = async (req: Request, res: Response) => {
  const project = await createProjectService(req.user!.id, req.body)
  sendSuccess(res, "Project created", project, HttpStatus.CREATED)
}

export const listProjectsController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListProjectsDto
  const projects = await listProjectsService(req.user!.id, filters)
  sendSuccess(res, "Projects fetched", projects)
}

export const getProjectController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const project = await getProjectService(id, req.user!.id)
  sendSuccess(res, "Project fetched", project)
}

export const updateProjectController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const project = await updateProjectService(id, req.user!.id, req.body)
  sendSuccess(res, "Project updated", project)
}

export const deleteProjectController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteProjectService(id, req.user!.id)
  sendSuccess(res, "Project deleted")
}
