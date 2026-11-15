import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { energyLevel } from "../task/task.schema.js"
import { MOVES } from "./step.rules.js"
import { addStepService, editStepService, letGoStepService, moveStepService } from "./step.service.js"
import prisma from "../../lib/prisma.js"
import { NotFoundError } from "../../shared/utils/errors.util.js"
import { recordActivity } from "../activity/activity.service.js"
import { guessArea } from "../firstrun/firstrun.rules.js"

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

// GET /steps/to-sort — to-dos with no area (from chat or a brain dump), oldest
// first, each with the area its words suggest when the person has one by that name.
// Reminders are left out: they belong to a time, not an area.
router.get("/to-sort", async (req: Request, res: Response) => {
  const userId = req.user!.id
  const [tasks, areas] = await Promise.all([
    prisma.task.findMany({
      where: { userId, areaId: null, archivedAt: null, remindAt: null, status: { in: ["TODO", "IN_PROGRESS"] } },
      select: { id: true, title: true },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
    prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true } }),
  ])
  const byName = new Map(areas.map((a) => [a.name.toLowerCase(), a.id]))
  sendSuccess(
    res,
    "To sort",
    tasks.map((t) => ({ id: t.id, title: t.title, suggestedAreaId: byName.get(guessArea(t.title).toLowerCase()) ?? null })),
  )
})

// POST /steps/:id/sort — put a to-do in an area. Undo takes it back to "to sort".
router.post("/:id/sort", async (req: Request, res: Response) => {
  const userId = req.user!.id
  const b = parse(z.object({ areaId: z.string().min(1) }), req.body)
  const [task, area] = await Promise.all([
    prisma.task.findFirst({ where: { id: String(req.params.id), userId, archivedAt: null }, select: { id: true, title: true, areaId: true } }),
    prisma.area.findFirst({ where: { id: b.areaId, userId }, select: { id: true, name: true } }),
  ])
  if (!task || !area) throw new NotFoundError("Not found")
  await prisma.task.update({ where: { id: task.id }, data: { areaId: area.id } })
  const ev = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "TASK",
    itemId: task.id,
    title: `${task.title} → ${area.name}`,
    source: "APP",
    undo: { kind: "RESTORE_FIELDS", model: "task", id: task.id, prev: { areaId: task.areaId } },
  })
  sendSuccess(res, "Sorted", { message: `${task.title} is in ${area.name}.`, activityId: ev?.id ?? null })
})

export default router
