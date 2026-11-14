import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { energyLevel } from "../task/task.schema.js"
import { MOVES } from "./step.rules.js"
import { addStepService, editStepService, letGoStepService, moveStepService } from "./step.service.js"

const router = Router()
router.use(authenticate)

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value)
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check what was sent.")
  return r.data
}

const fields = {
  sizeMinutes: z.number().int().positive().max(1440).nullable().optional(),
  energy: energyLevel.nullable().optional(),
  minimumVersion: z.string().max(200).nullable().optional(),
}

// POST /steps — a new step in an area.
router.post("/", async (req: Request, res: Response) => {
  const b = parse(z.object({ areaId: z.string().min(1), title: z.string().min(1).max(200), ...fields }), req.body)
  sendSuccess(res, "Step added", await addStepService(req.user!.id, b), 201)
})

// PATCH /steps/:id — name, length, energy, smaller version. Undo puts back what changed.
router.patch("/:id", async (req: Request, res: Response) => {
  const b = parse(z.object({ title: z.string().min(1).max(200).optional(), ...fields }), req.body)
  sendSuccess(res, "Step saved", await editStepService(req.user!.id, String(req.params.id), b))
})

// POST /steps/:id/move — tomorrow, the weekend, or next week; not suggested before then.
router.post("/:id/move", async (req: Request, res: Response) => {
  const b = parse(z.object({ when: z.enum(MOVES) }), req.body)
  sendSuccess(res, "Step moved", await moveStepService(req.user!.id, String(req.params.id), b.when))
})

// POST /steps/:id/let-go — archived, not destroyed; Undo brings it back.
router.post("/:id/let-go", async (req: Request, res: Response) => {
  sendSuccess(res, "Let go", await letGoStepService(req.user!.id, String(req.params.id)))
})

export default router
