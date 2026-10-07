import { Router } from "express"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import {
  assistantAskController,
  assistantChatController,
  listRemindersController,
  updateReminderController,
  listMemoriesController,
  deleteMemoryController,
  renameCapturedItemController,
} from "./assistant.controller.js"

const router = Router()

router.use(authenticate)

// POST /assistant/ask — the unified "Jarvis" persona. Routes to the
// decisions engine for "what should I do" style messages, and to the
// knowledge/life-data Q&A engine for everything else. One endpoint, one
// persona on the outside; two existing engines underneath.
router.post("/ask", assistantAskController)

// POST /assistant/chat — one chat that also acts: adds/completes tasks, logs
// habits, sets reminders. Reply + the actions it actually executed.
router.post("/chat", assistantChatController)
router.get("/reminders", listRemindersController)
router.patch("/reminders/:id", updateReminderController)
router.patch("/items/:type/:id", renameCapturedItemController)
router.get("/memories", listMemoriesController)
router.delete("/memories/:id", deleteMemoryController)

export default router
