import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { listActivity, undoActivityService } from "./activity.service.js"

const router = Router()
router.use(authenticate)

const listSchema = z.object({ days: z.coerce.number().int().positive().max(365).optional() })

// GET /activity?days=7: the history of what happened.
router.get("/", async (req: Request, res: Response) => {
  const { days } = listSchema.parse(req.query)
  const since = new Date(Date.now() - (days ?? 7) * 86_400_000)
  sendSuccess(res, "Activity", await listActivity(req.user!.id, since))
})

// POST /activity/:id/undo: reverse one action (chat receipts, notification answers).
router.post("/:id/undo", async (req: Request, res: Response) => {
  sendSuccess(res, "Undone", await undoActivityService(req.user!.id, String(req.params.id)))
})

export default router
