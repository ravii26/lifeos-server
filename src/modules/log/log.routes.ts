import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { addToCountService, logOverviewService, removeLogEntryService } from "./log.overview.service.js"

const router = Router()
router.use(authenticate)

// GET /log/overview — counts today, limits, spending this month, sleep, weight and the latest entries.
router.get("/overview", async (req: Request, res: Response) => sendSuccess(res, "Log", await logOverviewService(req.user!.id)))

// POST /log/count — +1 on a count habit (a notification button or the Plan row).
router.post("/count", async (req: Request, res: Response) => {
  const b = z.object({ habitId: z.string().min(1), n: z.number().int().min(1).max(50).default(1) }).safeParse(req.body)
  if (!b.success) throw new ValidationError(b.error.issues[0]?.message ?? "Invalid input")
  const out = await addToCountService(req.user!.id, b.data.habitId, b.data.n)
  if (!out) throw new NotFoundError("Count habit not found")
  sendSuccess(res, "Counted", out)
})

// DELETE /log/entries/:id — remove one entry (Undo puts it back).
router.delete("/entries/:id", async (req: Request, res: Response) => {
  const out = await removeLogEntryService(req.user!.id, String(req.params.id))
  if (!out) throw new NotFoundError("Entry not found")
  sendSuccess(res, "Entry removed", out)
})

export default router
