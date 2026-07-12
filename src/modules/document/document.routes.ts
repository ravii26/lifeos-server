import { Router } from "express"
import {
  createDocumentController,
  listDocumentsController,
  getDocumentController,
  deleteDocumentController,
  askController,
  extractController,
  listSuggestionsController,
  acceptSuggestionController,
  dismissSuggestionController,
} from "./document.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { uploadDocumentFile } from "../../shared/middleware/upload.middleware.js"
import {
  createDocumentSchema,
  listDocumentsSchema,
  askSchema,
  acceptSuggestionSchema,
} from "./document.schema.js"

const router = Router()

router.use(authenticate)

// uploadDocumentFile parses an optional "file" field (.txt/.md) for multipart
// requests and passes plain-JSON paste requests straight through.
router.post("/", uploadDocumentFile, validate(createDocumentSchema), createDocumentController)
router.get("/", validateQuery(listDocumentsSchema), listDocumentsController)
// Q&A over the user's documents. Registered before "/:id" so "ask" isn't
// swallowed as an id (it wouldn't be — different method — but order is clearer).
router.post("/ask", validate(askSchema), askController)

// Phase 2 — AI-extracted actions. Suggestion routes use a distinct
// "/suggestions/*" prefix so they never collide with "/:id".
router.post("/suggestions/:sid/accept", validate(acceptSuggestionSchema), acceptSuggestionController)
router.post("/suggestions/:sid/dismiss", dismissSuggestionController)
router.post("/:id/extract", extractController)
router.get("/:id/suggestions", listSuggestionsController)

router.get("/:id", getDocumentController)
router.delete("/:id", deleteDocumentController)

export default router
