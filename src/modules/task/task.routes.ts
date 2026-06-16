import { Router } from "express"
import {
  createTaskController,
  listTasksController,
  getTaskController,
  updateTaskController,
  completeTaskController,
  deleteTaskController,
} from "./task.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { createTaskSchema, updateTaskSchema, listTasksSchema } from "./task.schema.js"

const router = Router()

// All task routes are protected.
router.use(authenticate)

router.post("/", validate(createTaskSchema), createTaskController)
router.get("/", validateQuery(listTasksSchema), listTasksController)
router.get("/:id", getTaskController)
router.patch("/:id", validate(updateTaskSchema), updateTaskController)
router.patch("/:id/complete", completeTaskController)
router.delete("/:id", deleteTaskController)

export default router
