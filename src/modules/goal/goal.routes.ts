import { Router } from "express"
import {
  createGoalController,
  listGoalsController,
  getGoalController,
  updateGoalController,
  deleteGoalController,
} from "./goal.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { createGoalSchema, updateGoalSchema, listGoalsSchema } from "./goal.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createGoalSchema), createGoalController)
router.get("/", validateQuery(listGoalsSchema), listGoalsController)
router.get("/:id", getGoalController)
router.patch("/:id", validate(updateGoalSchema), updateGoalController)
router.delete("/:id", deleteGoalController)

export default router
