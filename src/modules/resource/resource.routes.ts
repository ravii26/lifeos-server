import { Router } from "express"
import {
  createResourceController,
  listResourcesController,
  getResourceController,
  updateResourceController,
  deleteResourceController,
  updateResourceProgressController,
} from "./resource.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import {
  createResourceSchema,
  updateResourceSchema,
  listResourcesSchema,
  updateProgressSchema,
} from "./resource.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createResourceSchema), createResourceController)
router.get("/", validateQuery(listResourcesSchema), listResourcesController)
router.get("/:id", getResourceController)
router.patch("/:id", validate(updateResourceSchema), updateResourceController)
router.delete("/:id", deleteResourceController)

// B8 — lesson/minute progress
router.patch("/:id/progress", validate(updateProgressSchema), updateResourceProgressController)

export default router
