import type { ActivitySource } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { dateFromKey, weekdayInTz } from "../../shared/utils/time.util.js"
import { getClock, getScheduleService } from "../now/now.service.js"
import { weeklyTargets } from "../now/brain.service.js"
import { targetPace } from "../now/brain.rules.js"
import { proposePlanAi } from "./goalplan.ai.js"
import { cautionFor, cleanPlan, fitPlan, type GoalPlan, type PlanCaution, type PlanFit } from "./goalplan.rules.js"

export interface GoalPlanProposal {
  plan: GoalPlan | null
  fit: PlanFit | null
  caution: PlanCaution | null
  // Planning needs general knowledge; false when no AI answered.
  aiAvailable: boolean
}

const hrs = (m: number) => `~${(m / 60).toFixed(1).replace(/\.0$/, "")} h`

// Free time per week from the person's day schedule (office hours excluded).
const freeTime = async (userId: string) => {
  const week = await getScheduleService(userId)
  let total = 0
  const weekdayByBlock = new Map<string, number>()
  let weekend = 0
  for (const d of week) {
    for (const b of d.blocks) {
      if (b.block === "OFFICE") continue
      total += b.freeMinutes
      if (d.weekday === 0 || d.weekday === 6) weekend += b.freeMinutes
      else weekdayByBlock.set(b.block, (weekdayByBlock.get(b.block) ?? 0) + b.freeMinutes / 5)
    }
  }
  const parts = [...weekdayByBlock].filter(([, m]) => m >= 10).map(([b, m]) => `${b} ${hrs(m)} on weekdays`)
  parts.push(`weekends ${hrs(weekend / 2)} a day`)
  return { total, description: parts.join(", ") }
}

export const proposeGoalPlanService = async (userId: string, goalText: string): Promise<GoalPlanProposal> => {
  const text = goalText.trim()
  if (text.length < 3) throw new ValidationError("Tell me the goal in a few words.")
  const c = await getClock(userId)
  const [free, targets, areas] = await Promise.all([
    freeTime(userId),
    weeklyTargets(userId, c),
    prisma.area.findMany({ where: { userId, isActive: true }, select: { name: true } }),
  ])
  const otherTargets = targets.map((t) => `${t.title} ${t.unit === "min" ? `${Math.round(t.target / 60)} h` : `${t.target} ${t.countUnit ?? ""}`}/week`)
  const raw = await proposePlanAi(text, {
    todayKey: c.todayKey,
    weekday: weekdayInTz(c.tz, c.now),
    weeklyFreeMinutes: free.total,
    freeByBlock: free.description,
    otherTargets,
    areas: areas.map((a) => a.name),
  })
  if (raw === null) return { plan: null, fit: null, caution: null, aiAvailable: false }
  const cleaned = cleanPlan(raw, c.todayKey)
  if (!cleaned) return { plan: null, fit: null, caution: null, aiAvailable: true }
  // Minutes already promised to other weekly targets (counted ones at 15 min each).
  const committed = targets.reduce((s, t) => s + (t.unit === "min" ? t.target : t.target * Math.min(60, t.sessionMinutes ?? 15)), 0)
  const { plan, fit } = fitPlan(cleaned, free.total, committed)
  const caution = cautionFor(
    targets.map((t) => {
      const p = targetPace(t)
      return { title: t.goalTitle ?? t.title, tier: t.tier, deadlineKey: t.deadlineKey, behind: p.behind > t.target * 0.15 }
    }),
    c.todayKey,
  )
  return { plan, fit, caution, aiAvailable: true }
}

// Keep the plan: one goal, one weekly-target project per line, and the
// stages as a milestone project. Parked: everything is kept but paused
// until the date. One Undo lets all of it go (never deletes).
export const acceptGoalPlanService = async (
  userId: string,
  input: { plan: unknown; park?: boolean; parkUntil?: string | null; areaId?: string | null },
  source: ActivitySource = "APP",
) => {
  const c = await getClock(userId)
  const plan = cleanPlan(input.plan, c.todayKey)
  if (!plan || !plan.targets.length) throw new ValidationError("That plan has nothing to keep yet.")

  let areaId = input.areaId ?? null
  if (areaId && !(await prisma.area.findFirst({ where: { id: areaId, userId }, select: { id: true } }))) areaId = null
  if (!areaId) {
    const areas = await prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, tier: true }, orderBy: { createdAt: "asc" } })
    areaId = areas.find((a) => a.tier === "MAIN")?.id ?? areas[0]?.id ?? null
  }
  if (!areaId) {
    // Their first goal: its area is named after it (their words, not ours).
    const area = await prisma.area.create({ data: { userId, name: plan.title.slice(0, 60), color: "#4b55d6", icon: "target", tier: "MAIN", order: 0 } })
    areaId = area.id
  }

  const parked = input.park === true
  const deadline = plan.deadline ? dateFromKey(plan.deadline) : null
  const goal = await prisma.goal.create({
    data: {
      userId, areaId, title: plan.title, why: plan.why, deadline,
      status: parked ? "PARKED" : "ACTIVE", parkedAt: parked ? new Date() : null, activatedAt: parked ? null : new Date(),
      description: parked && input.parkUntil ? `Parked until ${input.parkUntil}` : null,
    },
  })
  const projects: string[] = []
  for (const t of plan.targets) {
    const p = await prisma.project.create({
      data: {
        userId, areaId, goalId: goal.id, title: t.title, kind: "PRACTICE", deadline,
        status: parked ? "PAUSED" : "ACTIVE",
        weeklyTargetMinutes: t.unit === "min" ? t.perWeek : null,
        weeklyTargetCount: t.unit === "count" ? t.perWeek : null,
        countUnit: t.countUnit, sessionMinutes: t.sessionMinutes, timeBlock: t.block,
        description: t.note,
      },
    })
    projects.push(p.id)
  }
  if (plan.milestones.length) {
    const m = await prisma.project.create({
      data: {
        userId, areaId, goalId: goal.id, title: `${plan.title}: stages`.slice(0, 200), kind: "MILESTONE", deadline,
        status: parked ? "PAUSED" : "ACTIVE",
        milestones: { create: plan.milestones.map((title, order) => ({ title, order })) },
      },
    })
    projects.push(m.id)
  }
  const undo: UndoPayload = {
    kind: "MANY",
    items: [
      ...projects.map((projectId) => ({ kind: "ARCHIVE_PROJECT" as const, projectId })),
      { kind: "RESTORE_FIELDS", model: "goal", id: goal.id, prev: { status: "ABANDONED" } },
    ],
  }
  const ev = await recordActivity(userId, {
    type: "CREATED", itemType: "PROJECT", itemId: goal.id, title: parked ? `${plan.title} (parked)` : `${plan.title}: ${plan.targets.length} weekly targets`, source, undo,
  })
  return { goalId: goal.id, projectIds: projects, parked, activityId: ev?.id }
}
