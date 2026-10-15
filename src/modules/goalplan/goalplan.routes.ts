import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { acceptGoalPlanService, proposeGoalPlanService } from "./goalplan.service.js"

const router = Router()
router.use(authenticate)

const parse = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data)
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid input")
  return r.data
}

// POST /goal-plan/propose — a goal in your words → weekly targets (nothing saved).
router.post("/propose", async (req: Request, res: Response) => {
  const b = parse(z.object({ text: z.string().min(3).max(2000) }), req.body)
  sendSuccess(res, "Proposal", await proposeGoalPlanService(req.user!.id, b.text))
})

// POST /goal-plan/accept — keep the (possibly edited) plan, or park it.
router.post("/accept", async (req: Request, res: Response) => {
  const b = parse(
    z.object({ plan: z.unknown(), park: z.boolean().optional(), parkUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), areaId: z.string().nullish() }),
    req.body,
  )
  sendSuccess(res, "Kept", await acceptGoalPlanService(req.user!.id, b), 201)
})

export default router
