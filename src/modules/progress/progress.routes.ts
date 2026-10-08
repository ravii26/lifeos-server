import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import {
  getStandService,
  listStandsService,
  logProgressService,
  setProjectStatusService,
  refreshHabitStagesService,
  weekCardService,
} from "./progress.service.js"

const router = Router()
router.use(authenticate)

const parse = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data)
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid input")
  return r.data
}

// GET /progress/projects?all=true — where you stand on every project.
router.get("/projects", async (req: Request, res: Response) => {
  sendSuccess(res, "Where you stand", await listStandsService(req.user!.id, { all: req.query.all === "true" }))
})
router.get("/projects/:id", async (req: Request, res: Response) => {
  sendSuccess(res, "Where you stand", await getStandService(req.user!.id, String(req.params.id)))
})

// POST /progress/log — a count, minutes, or a reading (weight) for a project.
router.post("/log", async (req: Request, res: Response) => {
  const b = parse(
    z.object({
      projectId: z.string(),
      count: z.number().positive().optional(),
      minutes: z.number().positive().max(1440).optional(),
      value: z.number().optional(),
      milestoneDone: z.boolean().optional(),
      at: z.coerce.date().optional(),
    }),
    req.body,
  )
  sendSuccess(res, "Logged", await logProgressService(req.user!.id, b))
})

// POST /progress/projects/:id/status — pause, let go, resume, complete.
router.post("/projects/:id/status", async (req: Request, res: Response) => {
  const b = parse(z.object({ status: z.enum(["PAUSED", "ABANDONED", "ACTIVE", "COMPLETED"]) }), req.body)
  sendSuccess(res, "Status changed", await setProjectStatusService(req.user!.id, String(req.params.id), b.status))
})

// GET /progress/habits — consistency and stage (new / building / automatic).
router.get("/habits", async (req: Request, res: Response) => {
  sendSuccess(res, "Habit stages", await refreshHabitStagesService(req.user!.id))
})

// GET /progress/week — the weekly card, only when asked.
router.get("/week", async (req: Request, res: Response) => {
  const q = parse(z.object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional() }), req.query)
  sendSuccess(res, "This week", await weekCardService(req.user!.id, q.at))
})

export default router
