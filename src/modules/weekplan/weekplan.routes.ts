import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { validate } from "../../shared/middleware/validate.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { previewFitnessPlanService, startFitnessPlanService, getWeekPlansService } from "./weekplan.service.js"
import { previewCheckinService, applyCheckinService } from "./checkin.service.js"

const fitnessSchema = z.object({
  goal: z.enum(["LOSE_BELLY", "LOSE_WEIGHT", "BUILD_MUSCLE", "STAMINA"]),
  weightKg: z.number().min(30).max(250).nullable().optional(),
  heightCm: z.number().min(100).max(230).nullable().optional(),
  where: z.enum(["GYM", "HOME", "BOTH"]),
  diet: z.enum(["VEG", "VEG_EGG", "NON_VEG"]).nullable().optional(),
  homeFood: z.boolean().default(true),
  messFood: z.boolean().default(false),
  outsideOften: z.boolean().default(false),
  health: z.enum(["NONE", "CONDITION", "JOINT"]).default("NONE"),
})
type FitnessBody = z.infer<typeof fitnessSchema>

const router = Router()
router.use(authenticate)

// GET  /weekplan                  running plans ({ fitness: { title, week, weeks } | null })
// POST /weekplan/fitness/preview  the plan for these answers, nothing saved
// POST /weekplan/fitness          save it (goal + habits + rules note), one Undo
router.get("/", async (req: Request, res: Response) => {
  sendSuccess(res, "Weekly plans", await getWeekPlansService(req.user!.id))
})

// GET  /weekplan/checkin   last 7 days and what next week would be (nothing changes)
// POST /weekplan/checkin   apply next week + the weigh-in, one Undo; once a week
const checkinSchema = z.object({ weightKg: z.number().min(30).max(250).nullable().optional() })
router.get("/checkin", async (req: Request, res: Response) => {
  sendSuccess(res, "Check-in", await previewCheckinService(req.user!.id))
})
router.post("/checkin", validate(checkinSchema), async (req: Request, res: Response) => {
  sendSuccess(res, "Checked in", await applyCheckinService(req.user!.id, req.body as z.infer<typeof checkinSchema>))
})
router.post("/fitness/preview", validate(fitnessSchema), (req: Request, res: Response) => {
  sendSuccess(res, "Fitness plan", previewFitnessPlanService(req.body as FitnessBody))
})
router.post("/fitness", validate(fitnessSchema), async (req: Request, res: Response) => {
  sendSuccess(res, "Fitness plan started", await startFitnessPlanService(req.user!.id, req.body as FitnessBody), 201)
})

export default router
