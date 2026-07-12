import { Router } from "express"
import {
  createLinkController,
  listLinksController,
  deleteLinkController,
} from "./link.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { createLinkSchema, listLinksSchema } from "./link.schema.js"

const router = Router()

// All link routes are protected.
router.use(authenticate)

router.post("/", validate(createLinkSchema), createLinkController)
router.get("/", validateQuery(listLinksSchema), listLinksController)
router.delete("/:id", deleteLinkController)

export default router
