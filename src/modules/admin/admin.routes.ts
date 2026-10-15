import { Router } from "express"
import type { Request, Response, NextFunction } from "express"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ForbiddenError } from "../../shared/utils/errors.util.js"
import { env } from "../../config/env.config.js"
import { isAdminEmail } from "./admin.rules.js"
import { aiSummaryService, recentAiCallsService, recentSavesService, overviewService } from "./admin.service.js"

const router = Router()

// Only the emails in ADMIN_EMAILS. Everyone else gets 403, even when signed in.
const requireAdmin = (req: Request, _res: Response, next: NextFunction) => {
  if (!isAdminEmail(req.user?.email, env.ADMIN_EMAILS)) throw new ForbiddenError("Admins only")
  next()
}

router.use(authenticate, requireAdmin)

const limitOf = (v: unknown, fallback: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback
}

router.get("/overview", async (_req: Request, res: Response) => {
  sendSuccess(res, "Overview", await overviewService())
})

router.get("/ai/summary", async (_req: Request, res: Response) => {
  sendSuccess(res, "AI usage", await aiSummaryService())
})

// GET /admin/ai/calls?limit=50&failures=true
router.get("/ai/calls", async (req: Request, res: Response) => {
  sendSuccess(res, "AI calls", await recentAiCallsService(limitOf(req.query.limit, 50, 500), req.query.failures === "true"))
})

router.get("/saves", async (req: Request, res: Response) => {
  sendSuccess(res, "Saves", await recentSavesService(limitOf(req.query.limit, 30, 200)))
})

export default router
