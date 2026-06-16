import { Router } from "express"
import {
  createNoteController,
  listNotesController,
  getNoteController,
  updateNoteController,
  deleteNoteController,
} from "./note.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { createNoteSchema, updateNoteSchema, listNotesSchema } from "./note.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createNoteSchema), createNoteController)
router.get("/", validateQuery(listNotesSchema), listNotesController)
router.get("/:id", getNoteController)
router.patch("/:id", validate(updateNoteSchema), updateNoteController)
router.delete("/:id", deleteNoteController)

export default router
