// POST /numbers — start tracking a number in an area ("Weight, 82 → 75 kg").
// It is a goal's outcome project with a metric underneath, so readings use the
// existing POST /progress/log (with Undo) and chat can log it too.

import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import prisma from "../../lib/prisma.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { recordActivity } from "../activity/activity.service.js"
import { cleanNumber } from "./number.rules.js"

const router = Router()
router.use(authenticate)

router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id
  const b = z
    .object({ areaId: z.string().min(1), name: z.unknown(), unit: z.unknown().optional(), start: z.unknown(), target: z.unknown() })
    .safeParse(req.body)
  if (!b.success) throw new ValidationError("Say which area, what to track, where it is and where you want it.")
  const n = cleanNumber(b.data)
  if (typeof n === "string") throw new ValidationError(n)
  const area = await prisma.area.findFirst({ where: { id: b.data.areaId, userId }, select: { id: true } })
  if (!area) throw new NotFoundError("Area not found")
  // The area's first ordinary goal, so the number belongs to what it measures.
  const goal = await prisma.goal.findFirst({
    where: { userId, areaId: area.id, status: "ACTIVE", OR: [{ kind: null }, { kind: { not: "TASTES" } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  const p = await prisma.project.create({
    data: {
      userId,
      areaId: area.id,
      goalId: goal?.id ?? null,
      title: n.name,
      kind: "OUTCOME",
      metric: { create: { name: n.name, unit: n.unit, startValue: n.start, targetValue: n.target } },
    },
  })
  const ev = await recordActivity(userId, {
    type: "CREATED",
    itemType: "PROJECT",
    itemId: p.id,
    title: `Tracking ${n.name}`,
    source: "APP",
    undo: { kind: "ARCHIVE_PROJECT", projectId: p.id },
  })
  sendSuccess(res, "Tracking", { projectId: p.id, message: `Tracking ${n.name}. Add a reading whenever you check it.`, activityId: ev?.id }, 201)
})

export default router
