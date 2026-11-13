/* =====================================================================
   Weekly plans Ally runs for you (decisions log #1). The fitness pilot:
   preview from five answers, then save as things Ally already runs, so
   Now, reminders, logging and Undo all work without new machinery.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { getClock } from "../now/now.service.js"
import { dateFromKey } from "../../shared/utils/time.util.js"
import { CAPS } from "../season/season.rules.js"
import { buildFitnessPlan, PHASE_WEEKS, type FitnessAnswers } from "./fitness.rules.js"

export const previewFitnessPlanService = (answers: FitnessAnswers) => buildFitnessPlan(answers)

interface PlanMeta {
  kind?: string
  startedKey?: string
  phaseWeeks?: number
  goalId?: string
}

// GET /weekplan: the person's running plans (fitness only for now). A plan
// whose goal was let go or undone no longer counts.
export const getWeekPlansService = async (userId: string) => {
  const c = await getClock(userId)
  const notes = await prisma.allyNote.findMany({ where: { userId, collection: "Fitness", template: "PLAYBOOK" }, orderBy: { createdAt: "desc" }, take: 5 })
  for (const n of notes) {
    const m = (n.meta ?? {}) as PlanMeta
    if (m.kind !== "WEEKPLAN_FITNESS" || !m.goalId || !m.startedKey) continue
    const goal = await prisma.goal.findFirst({ where: { id: m.goalId, userId, status: "ACTIVE" }, select: { title: true } })
    if (!goal) continue
    const days = Math.max(0, Math.round((dateFromKey(c.todayKey).getTime() - dateFromKey(m.startedKey).getTime()) / 86_400_000))
    const weeks = m.phaseWeeks ?? PHASE_WEEKS
    return { fitness: { title: goal.title, week: Math.min(weeks, Math.floor(days / 7) + 1), weeks, noteId: n.id } }
  }
  return { fitness: null }
}

const FITNESS_NAME = /\b(fit|fitness|health|gym|body|weight|workout)/i

// The person's fitness area if they have one; otherwise one named "Fitness".
// It goes into focus only if focus has room: never a silent third focus.
const fitnessArea = async (userId: string) => {
  const areas = await prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true, tier: true } })
  const found = areas.find((a) => FITNESS_NAME.test(a.name))
  const focusFull = areas.filter((a) => a.tier === "MAIN").length >= CAPS.MAIN
  if (found) return { id: found.id, created: false, prevTier: found.tier, tier: found.tier }
  const area = await prisma.area.create({
    data: { userId, name: "Fitness", color: "#e0784f", icon: "dumbbell", tier: focusFull ? "MAINTAIN" : "MAIN", order: areas.length },
  })
  return { id: area.id, created: true, prevTier: null, tier: area.tier }
}

// POST /weekplan/fitness: saves the plan. One Undo takes all of it away (never deletes).
export const startFitnessPlanService = async (userId: string, answers: FitnessAnswers) => {
  const plan = buildFitnessPlan(answers)
  const c = await getClock(userId)
  const area = await fitnessArea(userId)
  const ends = dateFromKey(c.todayKey)
  ends.setUTCDate(ends.getUTCDate() + PHASE_WEEKS * 7)

  const goal = await prisma.goal.create({
    data: { userId, areaId: area.id, title: plan.title, why: "Your weekly fitness plan", deadline: ends, status: "ACTIVE", activatedAt: new Date() },
  })
  const project = plan.weight
    ? await prisma.project.create({
        data: {
          userId,
          areaId: area.id,
          goalId: goal.id,
          title: plan.title,
          kind: "OUTCOME",
          deadline: ends,
          why: "Weigh in once a week, on Sunday morning. The trend matters, not one day.",
          metric: { create: { name: "Weight", unit: "kg", startValue: plan.weight.start, targetValue: plan.weight.target } },
        },
      })
    : null
  const habits: Record<string, string> = {}
  for (const s of plan.sessions) {
    const h = await prisma.habit.create({
      data: {
        userId,
        areaId: area.id,
        title: s.title,
        description: s.detail,
        minimumVersion: s.smallest,
        habitType: "TIMER",
        targetMinutes: s.minutes,
        frequency: "CUSTOM",
        specificDays: s.week1Days,
        timeBlock: "MORNING",
      },
    })
    habits[s.key] = h.id
  }
  // The rules are a note the person can read and edit, and chat can read back
  // in the moment ("aaj party hai"). `meta` is the plan itself, read by code only.
  const note = await prisma.allyNote.create({
    data: {
      userId,
      collection: "Fitness",
      template: "PLAYBOOK",
      title: "Fitness rules",
      items: [...plan.foodRules, ...plan.lifeRules].map((i) => i.slice(0, 300)),
      text: plan.cautions.join(" "),
      meta: {
        kind: "WEEKPLAN_FITNESS",
        startedKey: c.todayKey,
        week: 1,
        phaseWeeks: plan.phaseWeeks,
        goalId: goal.id,
        projectId: project?.id ?? null,
        habits,
        fullDays: Object.fromEntries(plan.sessions.map((s) => [s.key, s.days])),
        answers: { ...answers },
      } as never,
    },
  })

  const undo: UndoPayload[] = [
    ...Object.values(habits).map((habitId) => ({ kind: "ARCHIVE_HABIT" as const, habitId })),
    ...(project ? [{ kind: "ARCHIVE_PROJECT" as const, projectId: project.id }] : []),
    { kind: "RESTORE_FIELDS", model: "goal", id: goal.id, prev: { status: "ABANDONED" } },
    { kind: "DELETE_ALLY_NOTE", noteId: note.id },
    ...(area.created ? [{ kind: "RESTORE_FIELDS" as const, model: "area" as const, id: area.id, prev: { isActive: false } }] : []),
  ]
  const ev = await recordActivity(userId, {
    type: "CREATED",
    itemType: "PROJECT",
    itemId: goal.id,
    title: `Fitness plan: ${plan.title}`,
    source: "APP",
    undo: { kind: "MANY", items: undo },
  })
  return { plan, goalId: goal.id, projectId: project?.id ?? null, habitIds: habits, noteId: note.id, areaId: area.id, inFocus: area.tier === "MAIN", activityId: ev?.id ?? null }
}
