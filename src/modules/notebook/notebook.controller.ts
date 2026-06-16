import type { Request, Response } from "express"
import {
  createNotebookService,
  listNotebooksService,
  getNotebookService,
  updateNotebookService,
  deleteNotebookService,
} from "./notebook.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListNotebooksDto } from "./notebook.schema.js"

export const createNotebookController = async (req: Request, res: Response) => {
  const notebook = await createNotebookService(req.user!.id, req.body)
  sendSuccess(res, "Notebook created", notebook, HttpStatus.CREATED)
}

export const listNotebooksController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListNotebooksDto
  const notebooks = await listNotebooksService(req.user!.id, filters)
  sendSuccess(res, "Notebooks fetched", notebooks)
}

export const getNotebookController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const notebook = await getNotebookService(id, req.user!.id)
  sendSuccess(res, "Notebook fetched", notebook)
}

export const updateNotebookController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const notebook = await updateNotebookService(id, req.user!.id, req.body)
  sendSuccess(res, "Notebook updated", notebook)
}

export const deleteNotebookController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteNotebookService(id, req.user!.id)
  sendSuccess(res, "Notebook deleted")
}
