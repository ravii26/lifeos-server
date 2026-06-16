import type { Request, Response } from "express"
import {
  createNoteService,
  listNotesService,
  getNoteService,
  updateNoteService,
  deleteNoteService,
} from "./note.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import type { ListNotesDto } from "./note.schema.js"

export const createNoteController = async (req: Request, res: Response) => {
  const note = await createNoteService(req.user!.id, req.body)
  sendSuccess(res, "Note created", note, HttpStatus.CREATED)
}

export const listNotesController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListNotesDto
  const notes = await listNotesService(req.user!.id, filters)
  sendSuccess(res, "Notes fetched", notes)
}

export const getNoteController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const note = await getNoteService(id, req.user!.id)
  sendSuccess(res, "Note fetched", note)
}

export const updateNoteController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const note = await updateNoteService(id, req.user!.id, req.body)
  sendSuccess(res, "Note updated", note)
}

export const deleteNoteController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteNoteService(id, req.user!.id)
  sendSuccess(res, "Note deleted")
}
