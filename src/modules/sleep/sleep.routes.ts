import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { validate } from "../../shared/middleware/validate.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { getSleepPlanService, startSleepPlanService, sleepCheckinService } from "./sleep.service.js"

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const startSchema = z.object({ nowWake: hhmm, targetWake: hhmm, hours: z.number().int().min(300).max(600) })
const checkinSchema = z.object({ daysOnTime: z.number().int().min(0).max(7) })

const router = Router()
router.use(authenticate)

// GET  /sleep          the plan (null if none), with every step of the ladder
// POST /sleep          start or restart it; week 1 goes into the day at once
// POST /sleep/checkin  "how many days did you keep your wake time?" (moves on at 5 of 7)
router.get("/", async (req: Request, res: Response) => {
  sendSuccess(res, "Sleep plan", await getSleepPlanService(req.user!.id))
})
router.post("/", validate(startSchema), async (req: Request, res: Response) => {
  sendSuccess(res, "Sleep plan started", await startSleepPlanService(req.user!.id, req.body as z.infer<typeof startSchema>), 201)
})
router.post("/checkin", validate(checkinSchema), async (req: Request, res: Response) => {
  sendSuccess(res, "Sleep check-in", await sleepCheckinService(req.user!.id, (req.body as z.infer<typeof checkinSchema>).daysOnTime))
})

export default router
