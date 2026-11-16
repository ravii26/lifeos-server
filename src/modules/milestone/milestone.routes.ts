import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { addMilestoneService, letGoMilestoneService, proposeMilestonesService, reachMilestoneService, setMilestonesService } from "./milestone.service.js"

const router = Router()
router.use(authenticate)

const parse = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data)
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid input")
  return r.data
}

// POST /milestones/propose — a draft for a goal (AI, or three plain ones). Nothing saved.
router.post("/propose", async (req: Request, res: Response) => {
  const b = parse(z.object({ goalId: z.string().min(1) }), req.body)
  sendSuccess(res, "Draft", await proposeMilestonesService(req.user!.id, b.goalId))
})

// POST /milestones — keep the (edited) milestones under a goal. One Undo.
router.post("/", async (req: Request, res: Response) => {
  const b = parse(z.object({ goalId: z.string().min(1), milestones: z.array(z.string().max(200)).max(12) }), req.body)
  sendSuccess(res, "Kept", await setMilestonesService(req.user!.id, b.goalId, b.milestones), 201)
})

// POST /milestones/add — one more at the end.
router.post("/add", async (req: Request, res: Response) => {
  const b = parse(z.object({ goalId: z.string().min(1), title: z.string().min(1).max(200) }), req.body)
  sendSuccess(res, "Added", await addMilestoneService(req.user!.id, b.goalId, b.title), 201)
})

// POST /milestones/:id/reached — the current one is reached; the next opens.
router.post("/:id/reached", async (req: Request, res: Response) => {
  sendSuccess(res, "Reached", await reachMilestoneService(req.user!.id, String(req.params.id)))
})

// POST /milestones/:id/let-go — kept, not deleted, with its open steps.
router.post("/:id/let-go", async (req: Request, res: Response) => {
  sendSuccess(res, "Let go", await letGoMilestoneService(req.user!.id, String(req.params.id)))
})

export default router
