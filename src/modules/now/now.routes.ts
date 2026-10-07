import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import {
  getNowService,
  getModeService,
  setModeService,
  getScheduleService,
  setScheduleService,
  capacityTodayService,
  moveTasksToLaterService,
  markPrepDoneService,
} from "./now.service.js"
import { MODES } from "./now.rules.js"

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
  const q = parse(z.object({ minutes: z.coerce.number().int().positive().optional(), at }), req.query)
  sendSuccess(res, "Right now", await getNowService(req.user!.id, q))
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

export default router
