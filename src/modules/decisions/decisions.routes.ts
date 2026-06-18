import { Router } from "express"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { getDecisionsController } from "./decisions.controller.js"

const router = Router()

router.use(authenticate)

// GET /decisions/now — "what should I do right now?"
// Assembles user context (area scores, tasks, habits, behavior) and asks
// Gemini for ranked suggestions. Falls back to heuristic if no API key.
router.get("/now", getDecisionsController)

export default router
