import { Router } from "express"
import {
  createNotebookController,
  listNotebooksController,
  getNotebookController,
  updateNotebookController,
  deleteNotebookController,
} from "./notebook.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { createNotebookSchema, updateNotebookSchema, listNotebooksSchema } from "./notebook.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createNotebookSchema), createNotebookController)
router.get("/", validateQuery(listNotebooksSchema), listNotebooksController)
router.get("/:id", getNotebookController)
router.patch("/:id", validate(updateNotebookSchema), updateNotebookController)
router.delete("/:id", deleteNotebookController)

export default router
