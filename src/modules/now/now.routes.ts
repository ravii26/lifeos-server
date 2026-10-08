import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import {
  getNowService,
  getClock,
  getModeService,
  setModeService,
  getScheduleService,
  setScheduleService,
  capacityTodayService,
  moveTasksToLaterService,
  markPrepDoneService,
} from "./now.service.js"
import { getPlanService, respondNowService, getStaleService, resolveStaleService } from "./plan.service.js"
import { MODES } from "./now.rules.js"
import { maybeRefreshHabitStages } from "../progress/progress.service.js"

const router = Router()
router.use(authenticate)

const parse = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data)
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid input")
  return r.data
}

const at = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional()

// GET /now?minutes=20 — the right thing for right now.
router.get("/", async (req: Request, res: Response) => {
  const q = parse(z.object({ minutes: z.coerce.number().int().positive().optional(), at, smallest: z.enum(["true", "false"]).optional() }), req.query)
  await maybeRefreshHabitStages(req.user!.id, await getClock(req.user!.id, q.at))
  sendSuccess(res, "Right now", await getNowService(req.user!.id, { minutes: q.minutes, at: q.at, smallest: q.smallest === "true" }))
})

// POST /now/prep/:habitId/done — the prep step is done for tonight.
router.post("/prep/:habitId/done", async (req: Request, res: Response) => {
  const event = await markPrepDoneService(req.user!.id, String(req.params.habitId))
  if (!event) throw new NotFoundError("Habit not found")
  sendSuccess(res, "Prep done", { activityId: event.id })
})

router.get("/mode", async (req: Request, res: Response) => sendSuccess(res, "Mode", await getModeService(req.user!.id)))
router.put("/mode", async (req: Request, res: Response) => {
  const b = parse(z.object({ mode: z.enum(MODES as [string, ...string[]]), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }), req.body)
  sendSuccess(res, "Mode set", await setModeService(req.user!.id, b.mode as (typeof MODES)[number], b.until ?? null))
})

router.get("/schedule", async (req: Request, res: Response) => sendSuccess(res, "Schedule", await getScheduleService(req.user!.id)))
router.put("/schedule", async (req: Request, res: Response) => {
  const b = parse(z.object({ weekdays: z.array(z.number().int().min(0).max(6)).min(1), blocks: z.array(z.unknown()).min(1) }), req.body)
  const out = await setScheduleService(req.user!.id, b.weekdays, b.blocks)
  if (!out) throw new ValidationError("Those blocks aren't valid. Use HH:mm times and known block names.")
  sendSuccess(res, "Schedule set", out)
})

// GET /now/capacity — what's planned for today against the free time left.
router.get("/capacity", async (req: Request, res: Response) => {
  const q = parse(z.object({ at }), req.query)
  sendSuccess(res, "Capacity", await capacityTodayService(req.user!.id, q.at))
})

// POST /now/move — take these to-dos off today (they keep existing, undated).
router.post("/move", async (req: Request, res: Response) => {
  const b = parse(z.object({ taskIds: z.array(z.string()).min(1).max(50) }), req.body)
  sendSuccess(res, "Moved", await moveTasksToLaterService(req.user!.id, b.taskIds))
})

// GET /now/plan — today by part of the day, this week, goals, habits.
router.get("/plan", async (req: Request, res: Response) => {
  const q = parse(z.object({ at }), req.query)
  sendSuccess(res, "Plan", await getPlanService(req.user!.id, q.at))
})

// POST /now/respond — Done / Smaller (the minimum) / Not now, for the card on Now.
router.post("/respond", async (req: Request, res: Response) => {
  const b = parse(
    z.object({ sourceType: z.enum(["TASK", "HABIT"]), sourceId: z.string(), action: z.enum(["DONE", "MINIMUM", "SKIP"]), reason: z.string().max(200).optional() }),
    req.body,
  )
  sendSuccess(res, "Answered", await respondNowService(req.user!.id, b))
})

// GET /now/stale — "still want these 5?" (to-dos untouched for 30 days).
router.get("/stale", async (req: Request, res: Response) => {
  const q = parse(z.object({ at }), req.query)
  sendSuccess(res, "Stale to-dos", await getStaleService(req.user!.id, q.at))
})
router.post("/stale/resolve", async (req: Request, res: Response) => {
  const b = parse(z.object({ keepIds: z.array(z.string()).max(50).default([]), letGoIds: z.array(z.string()).max(50).default([]) }), req.body)
  sendSuccess(res, "Answered", await resolveStaleService(req.user!.id, b))
})

export default router
