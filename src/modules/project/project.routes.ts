import { Router } from "express"
import {
  createProjectController,
  listProjectsController,
  getProjectController,
  updateProjectController,
  deleteProjectController,
} from "./project.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { createProjectSchema, updateProjectSchema, listProjectsSchema } from "./project.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createProjectSchema), createProjectController)
router.get("/", validateQuery(listProjectsSchema), listProjectsController)
router.get("/:id", getProjectController)
router.patch("/:id", validate(updateProjectSchema), updateProjectController)
router.delete("/:id", deleteProjectController)

export default router
