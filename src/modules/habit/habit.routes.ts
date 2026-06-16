import { Router } from "express"
import {
  createHabitController,
  listHabitsController,
  getHabitController,
  updateHabitController,
  deleteHabitController,
  logHabitController,
  listHabitLogsController,
} from "./habit.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import {
  createHabitSchema,
  updateHabitSchema,
  listHabitsSchema,
  logHabitSchema,
  listLogsSchema,
} from "./habit.schema.js"

const router = Router()

// All habit routes are protected.
router.use(authenticate)

router.post("/", validate(createHabitSchema), createHabitController)
router.get("/", validateQuery(listHabitsSchema), listHabitsController)
router.get("/:id", getHabitController)
router.patch("/:id", validate(updateHabitSchema), updateHabitController)
router.delete("/:id", deleteHabitController)

// Daily logging
router.post("/:id/log", validate(logHabitSchema), logHabitController)
router.get("/:id/logs", validateQuery(listLogsSchema), listHabitLogsController)

export default router
