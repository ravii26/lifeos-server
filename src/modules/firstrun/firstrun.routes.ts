// First run (ALLY.md 2.1).
// POST /firstrun/sort  — everything someone wants → items in areas, a mode for each (nothing saved).
// POST /firstrun/apply — the checked result → areas, goals, to-dos and routines, with one Undo.

import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import prisma from "../../lib/prisma.js"
import { getUserNow } from "../../lib/rag.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { dateFromKey } from "../../shared/utils/time.util.js"
import { hhmm } from "../task/task.schema.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { AREA_COLORS, AREA_ICON_NAMES, extractOnboardingSetup } from "../onboarding/onboarding.extract.js"
import { fallbackSort, fromExtraction, MAX_AREAS, MAX_ITEMS, startingMinutes, suggestModes, TIER, type Mode } from "./firstrun.rules.js"

const router = Router()
router.use(authenticate)

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value)
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check what was sent.")
  return r.data
}

router.post("/sort", async (req: Request, res: Response) => {
  const b = parse(z.object({ text: z.string().trim().min(3, "Say a little more: a few things you want.").max(4000) }), req.body)
  const now = await getUserNow(req.user!.id)
  const x = await extractOnboardingSetup(b.text, [], now)
  let items = fromExtraction(x, now.isoDate, b.text)
  const byCode = items.length === 0
  if (byCode) items = fallbackSort(b.text, now.isoDate)
  if (!items.length) throw new ValidationError("I couldn't find separate things in that. Try one thing per line.")
  sendSuccess(res, "Sorted", { items, areas: suggestModes(items, b.text, now.isoDate), byCode })
})

const MODES = ["PUSH", "MAINTAIN", "EXPLORE", "REST"] as const
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

router.post("/apply", async (req: Request, res: Response) => {
  const userId = req.user!.id
  const b = parse(
    z.object({
      areas: z
        .array(z.object({ name: z.string().trim().min(1).max(60), mode: z.enum(MODES), weeklyMinutes: z.number().int().min(0).max(1200).optional() }))
        .min(1)
        .max(MAX_AREAS),
      items: z
        .array(z.object({ title: z.string().trim().min(1).max(200), kind: z.enum(["GOAL", "TASK", "HABIT"]), areaName: z.string().trim().min(1).max(60), due: day.nullish(), dueKind: z.enum(["ON", "BY"]).nullish(), windowFrom: hhmm.nullish(), windowTo: hhmm.nullish() }))
        .max(MAX_ITEMS),
    }),
    req.body,
  )
  const key = (s: string) => s.trim().toLowerCase()
  // Running first run again reuses areas of the same name instead of making twins.
  const existing = await prisma.area.findMany({ where: { userId }, select: { id: true, name: true, order: true } })
  let order = existing.reduce((m, a) => Math.max(m, a.order), -1)
  const undo: UndoPayload[] = []
  const areaId = new Map<string, string>()
  const areasOut: { id: string; name: string; mode: Mode }[] = []

  for (const [n, a] of b.areas.entries()) {
    const found = existing.find((e) => key(e.name) === key(a.name))
    const weeklyMinutes = a.weeklyMinutes ?? startingMinutes(a.mode)
    if (found) {
      const prev = await prisma.area.findUnique({ where: { id: found.id }, select: { tier: true, weeklyMinutes: true, isActive: true } })
      await prisma.area.update({ where: { id: found.id }, data: { tier: TIER[a.mode], weeklyMinutes, isActive: true } })
      undo.push({ kind: "RESTORE_FIELDS", model: "area", id: found.id, prev: { tier: prev?.tier, weeklyMinutes: prev?.weeklyMinutes ?? null, isActive: prev?.isActive ?? true } })
      areaId.set(key(a.name), found.id)
      areasOut.push({ id: found.id, name: found.name, mode: a.mode })
      continue
    }
    const made = await prisma.area.create({
      data: {
        userId,
        name: a.name,
        tier: TIER[a.mode],
        weeklyMinutes,
        color: AREA_COLORS[n % AREA_COLORS.length],
        icon: AREA_ICON_NAMES[n % AREA_ICON_NAMES.length],
        order: ++order,
      },
    })
    undo.push({ kind: "RESTORE_FIELDS", model: "area", id: made.id, prev: { isActive: false } })
    areaId.set(key(a.name), made.id)
    areasOut.push({ id: made.id, name: made.name, mode: a.mode })
  }

  const goals: { id: string; title: string; areaId: string }[] = []
  let tasks = 0
  let habits = 0
  for (const i of b.items) {
    const id = areaId.get(key(i.areaName))
    if (!id) continue // an item whose area was removed is left out
    if (i.kind === "GOAL") {
      const g = await prisma.goal.create({ data: { userId, areaId: id, title: i.title, deadline: i.due ? dateFromKey(i.due) : null } })
      undo.push({ kind: "RESTORE_FIELDS", model: "goal", id: g.id, prev: { status: "ABANDONED" } })
      goals.push({ id: g.id, title: g.title, areaId: id })
    } else if (i.kind === "HABIT") {
      const h = await prisma.habit.create({ data: { userId, areaId: id, title: i.title } })
      undo.push({ kind: "ARCHIVE_HABIT", habitId: h.id })
      habits++
    } else {
      const t = await prisma.task.create({ data: { userId, areaId: id, title: i.title, dueDate: i.due ? dateFromKey(i.due) : null, dueKind: i.due ? (i.dueKind ?? "ON") : null, windowFrom: i.windowFrom && i.windowTo ? i.windowFrom : null, windowTo: i.windowFrom && i.windowTo ? i.windowTo : null, sizeMinutes: 25, source: "DUMP" } })
      undo.push({ kind: "ARCHIVE_TASK", taskId: t.id })
      tasks++
    }
  }

  const ev = await recordActivity(userId, {
    type: "CREATED",
    itemType: "SETTING",
    title: `First run: ${areasOut.length} areas`,
    source: "APP",
    undo: { kind: "MANY", items: undo },
  })
  sendSuccess(res, "Set up", { areas: areasOut, goals, tasks, habits, activityId: ev?.id ?? null }, 201)
})

export default router
