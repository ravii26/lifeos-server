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
import { uploadCaptureMedia } from "../../shared/middleware/upload.middleware.js"
import {
  createCaptureSchema,
  updateCaptureSchema,
  convertCaptureSchema,
  listCapturesSchema,
} from "./capture.schema.js"

const router = Router()

router.use(authenticate)

// uploadCaptureMedia parses an optional "file" field (image/audio) for
// multipart requests and passes plain-JSON text captures straight through.
router.post("/", uploadCaptureMedia, validate(createCaptureSchema), createCaptureController)
router.get("/", validateQuery(listCapturesSchema), listCapturesController)
router.patch("/:id", validate(updateCaptureSchema), updateCaptureController)
router.post("/:id/convert", validate(convertCaptureSchema), convertCaptureController)
router.delete("/:id", deleteCaptureController)

export default router
