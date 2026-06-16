import { Router } from "express"
import {
  startFocusController,
  stopFocusController,
  listFocusController,
  getFocusController,
  updateFocusController,
  deleteFocusController,
} from "./focus.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { startFocusSchema, updateFocusSchema, listFocusSchema } from "./focus.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(startFocusSchema), startFocusController)
router.get("/", validateQuery(listFocusSchema), listFocusController)
router.get("/:id", getFocusController)
router.patch("/:id/stop", stopFocusController)
router.patch("/:id", validate(updateFocusSchema), updateFocusController)
router.delete("/:id", deleteFocusController)

export default router
