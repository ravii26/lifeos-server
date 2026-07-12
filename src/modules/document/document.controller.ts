import type { Request, Response } from "express"
import {
  createDocumentService,
  listDocumentsService,
  getDocumentService,
  deleteDocumentService,
  askDocumentService,
  extractDocumentService,
  listSuggestionsService,
  acceptSuggestionService,
  dismissSuggestionService,
} from "./document.service.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { HttpStatus } from "../../shared/constants/httpStatus.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import type { ListDocumentsDto, AskDto } from "./document.schema.js"

const filenameTitle = (name?: string): string | undefined => {
  if (!name) return undefined
  return name.replace(/\.[^.]+$/, "").trim() || undefined
}

export const createDocumentController = async (req: Request, res: Response) => {
  const file = req.file // populated by uploadDocumentFile for multipart requests
  const body = req.body as {
    title?: string
    text?: string
    topicId?: string
    notebookId?: string
  }

  let text: string
  let sourceType: "PASTED" | "UPLOADED"
  let title = body.title

  if (file) {
    text = file.buffer.toString("utf-8")
    sourceType = "UPLOADED"
    if (!title) title = filenameTitle(file.originalname)
  } else if (body.text) {
    text = body.text
    sourceType = "PASTED"
  } else {
    throw new ValidationError("Provide text or upload a .txt/.md file")
  }

  const doc = await createDocumentService(req.user!.id, {
    title,
    text,
    sourceType,
    topicId: body.topicId,
    notebookId: body.notebookId,
  })
  sendSuccess(res, "Document created", doc, HttpStatus.CREATED)
}

export const listDocumentsController = async (req: Request, res: Response) => {
  const filters = (res.locals.query ?? {}) as ListDocumentsDto
  const docs = await listDocumentsService(req.user!.id, filters)
  sendSuccess(res, "Documents fetched", docs)
}

export const getDocumentController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const doc = await getDocumentService(id, req.user!.id)
  sendSuccess(res, "Document fetched", doc)
}

export const deleteDocumentController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteDocumentService(id, req.user!.id)
  sendSuccess(res, "Document deleted")
}

export const askController = async (req: Request, res: Response) => {
  const { question, documentId } = req.body as AskDto
  const result = await askDocumentService(req.user!.id, question, documentId)
  sendSuccess(res, "Answer generated", result)
}

export const extractController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const suggestions = await extractDocumentService(id, req.user!.id)
  sendSuccess(res, "Actions extracted", suggestions)
}

export const listSuggestionsController = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const suggestions = await listSuggestionsService(id, req.user!.id)
  sendSuccess(res, "Suggestions fetched", suggestions)
}

export const acceptSuggestionController = async (req: Request, res: Response) => {
  const { sid } = req.params as { sid: string }
  const result = await acceptSuggestionService(sid, req.user!.id, req.body)
  sendSuccess(res, "Suggestion accepted", result, HttpStatus.CREATED)
}

export const dismissSuggestionController = async (req: Request, res: Response) => {
  const { sid } = req.params as { sid: string }
  await dismissSuggestionService(sid, req.user!.id)
  sendSuccess(res, "Suggestion dismissed")
}
