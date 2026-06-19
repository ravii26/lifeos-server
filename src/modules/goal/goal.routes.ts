import { Router } from "express"
import {
  createGoalController,
  listGoalsController,
  getGoalBoardController,
  getGoalController,
  getGoalConfidenceController,
  updateGoalController,
  deleteGoalController,
  activateGoalController,
  parkGoalController,
} from "./goal.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import {
  createGoalSchema,
  updateGoalSchema,
  listGoalsSchema,
  activateGoalSchema,
} from "./goal.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createGoalSchema), createGoalController)
router.get("/", validateQuery(listGoalsSchema), listGoalsController)
// Static path before "/:id" so it isn't swallowed as an id param.
router.get("/board", getGoalBoardController)
router.get("/:id", getGoalController)
router.get("/:id/confidence", getGoalConfidenceController)
router.patch("/:id", validate(updateGoalSchema), updateGoalController)
router.delete("/:id", deleteGoalController)

// Focus management (priority cap + parking)
router.post("/:id/activate", validate(activateGoalSchema), activateGoalController)
router.post("/:id/park", parkGoalController)

export default router
