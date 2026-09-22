import { Router } from "express"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { getDecisionsController, answerProfilePromptController } from "./decisions.controller.js"

const router = Router()

router.use(authenticate)

// GET /decisions/now — "what should I do right now?"
// Assembles user context (area scores, tasks, habits, behavior) and asks
// Gemini for ranked suggestions. Falls back to heuristic if no API key.
router.get("/now", getDecisionsController)

// POST /decisions/profile-answer — answers the one-question profiling
// prompt from the last /now response, writing straight to Identity.
router.post("/profile-answer", answerProfilePromptController)

export default router
