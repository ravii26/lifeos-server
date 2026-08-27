import { Router } from "express"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { assistantAskController } from "./assistant.controller.js"

const router = Router()

router.use(authenticate)

// POST /assistant/ask — the unified "Jarvis" persona. Routes to the
// decisions engine for "what should I do" style messages, and to the
// knowledge/life-data Q&A engine for everything else. One endpoint, one
// persona on the outside; two existing engines underneath.
router.post("/ask", assistantAskController)

export default router
