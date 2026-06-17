import { Router } from "express"
import {
  createCaptureController,
  listCapturesController,
  updateCaptureController,
  convertCaptureController,
  deleteCaptureController,
} from "./capture.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import {
  createCaptureSchema,
  updateCaptureSchema,
  convertCaptureSchema,
  listCapturesSchema,
} from "./capture.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createCaptureSchema), createCaptureController)
router.get("/", validateQuery(listCapturesSchema), listCapturesController)
router.patch("/:id", validate(updateCaptureSchema), updateCaptureController)
router.post("/:id/convert", validate(convertCaptureSchema), convertCaptureController)
router.delete("/:id", deleteCaptureController)

export default router
