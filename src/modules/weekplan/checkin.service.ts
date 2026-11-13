/* =====================================================================
   The Sunday check-in for the fitness plan: look at the last 7 days,
   decide next week by rule (checkin.rules.ts), log the weekly weigh-in.
   Preview changes nothing; apply writes it with one Undo. Once a week:
   a second apply in the same week only returns what was decided.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { getClock } from "../now/now.service.js"
import { mondayOf } from "../now/brain.service.js"
import { dateFromKey, daysBetweenKeys, utcDayKey } from "../../shared/utils/time.util.js"
import { decideCheckin, weightLine, type SessionState } from "./checkin.rules.js"
import { PHASE_WEEKS } from "./fitness.rules.js"

const CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

interface Meta {
  kind?: string
  startedKey?: string
  phaseWeeks?: number
  goalId?: string
  projectId?: string | null
  habits?: Record<string, string>
  fullDays?: Record<string, string[]>
  fullInARow?: number
  lastCheckinWeek?: string // Monday key of the week last checked in
  lastResult?: { done: number; planned: number; verdict: string; message: string }
  [k: string]: unknown
}

const loadPlan = async (userId: string) => {
  const notes = await prisma.allyNote.findMany({ where: { userId, collection: "Fitness", template: "PLAYBOOK" }, orderBy: { createdAt: "desc" }, take: 5 })
  for (const n of notes) {
    const m = (n.meta ?? {}) as Meta
    if (m.kind !== "WEEKPLAN_FITNESS" || !m.goalId || !m.habits || !m.startedKey) continue
    const goal = await prisma.goal.findFirst({ where: { id: m.goalId, userId, status: "ACTIVE" }, select: { id: true } })
    if (goal) return { note: n, meta: m }
  }
  return null
}

const build = async (userId: string) => {
  const c = await getClock(userId)
  const plan = await loadPlan(userId)
  if (!plan) return null
  const { meta } = plan
  const habitIds = Object.values(meta.habits!)
  const habits = await prisma.habit.findMany({ where: { id: { in: habitIds }, userId, isActive: true } })
  // The last 7 days, today included.
  const from = dateFromKey(c.todayKey)
  from.setUTCDate(from.getUTCDate() - 6)
  const logs = await prisma.habitLog.findMany({ where: { userId, habitId: { in: habitIds }, completed: true, date: { gte: from, lte: dateFromKey(c.todayKey) } }, select: { habitId: true } })
  let planned = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(from)
    d.setUTCDate(d.getUTCDate() + i)
    const code = CODES[d.getUTCDay()]!
    planned += habits.filter((h) => h.specificDays.includes(code)).length
  }
  const done = Math.min(planned || logs.length, logs.length)
  const keyOf = (id: string) => Object.entries(meta.habits!).find(([, v]) => v === id)?.[0] ?? "SESSION"
  const sessions: SessionState[] = habits.map((h) => ({
    key: keyOf(h.id),
    habitId: h.id,
    title: h.title,
    minutes: h.targetMinutes ?? 30,
    days: h.specificDays,
    fullDays: meta.fullDays?.[keyOf(h.id)] ?? h.specificDays,
  }))
  const weeks = meta.phaseWeeks ?? PHASE_WEEKS
  const week = Math.min(weeks, Math.floor(Math.max(0, daysBetweenKeys(meta.startedKey!, c.todayKey)) / 7) + 1)
  const decision = decideCheckin(sessions, { done, planned }, meta.fullInARow ?? 0, week + 1)

  const metric = meta.projectId ? await prisma.metric.findUnique({ where: { projectId: meta.projectId }, include: { entries: { orderBy: { at: "desc" }, take: 1 } } }) : null
  const lastWeight = metric ? (metric.entries[0]?.value ?? metric.startValue) : null
  const thisWeek = mondayOf(c.todayKey).key
  return { c, plan, decision, done, planned, week, weeks, metric, lastWeight, thisWeek, alreadyDone: meta.lastCheckinWeek === thisWeek }
}

// GET /weekplan/checkin: what last week looked like and what next week would be. Nothing changes.
export const previewCheckinService = async (userId: string) => {
  const b = await build(userId)
  if (!b) return { fitness: null }
  return {
    fitness: {
      week: b.week,
      weeks: b.weeks,
      done: b.done,
      planned: b.planned,
      verdict: b.alreadyDone ? (b.plan.meta.lastResult?.verdict ?? b.decision.verdict) : b.decision.verdict,
      message: b.alreadyDone ? (b.plan.meta.lastResult?.message ?? b.decision.message) : b.decision.message,
      sessions: b.decision.sessions,
      askWeight: !!b.metric,
      lastWeight: b.lastWeight,
      alreadyDone: b.alreadyDone,
    },
  }
}

// POST /weekplan/checkin: apply next week and log the weigh-in. One Undo.
export const applyCheckinService = async (userId: string, input: { weightKg?: number | null }) => {
  const b = await build(userId)
  if (!b) throw new ValidationError("There's no weekly plan to check in on yet")
  if (b.alreadyDone) return { ...(await previewCheckinService(userId)), activityId: null, weightLine: null }

  const undo: UndoPayload[] = []
  for (const s of b.decision.sessions) {
    if (!s.changed) continue
    const h = await prisma.habit.findFirst({ where: { id: s.habitId, userId }, select: { targetMinutes: true, specificDays: true } })
    if (!h) continue
    undo.push({ kind: "RESTORE_FIELDS", model: "habit", id: s.habitId, prev: { targetMinutes: h.targetMinutes, specificDays: h.specificDays } })
    await prisma.habit.update({ where: { id: s.habitId }, data: { targetMinutes: s.minutes, specificDays: s.days } })
  }
  undo.push({ kind: "RESTORE_FIELDS", model: "allyNote", id: b.plan.note.id, prev: { meta: b.plan.note.meta } })
  await prisma.allyNote.update({
    where: { id: b.plan.note.id },
    data: {
      meta: {
        ...b.plan.meta,
        fullInARow: b.decision.fullInARow,
        lastCheckinWeek: b.thisWeek,
        lastResult: { done: b.done, planned: b.planned, verdict: b.decision.verdict, message: b.decision.message },
      } as never,
    },
  })

  let line: string | null = null
  if (b.metric && typeof input.weightKg === "number" && input.weightKg >= 30 && input.weightKg <= 250) {
    const entry = await prisma.metricEntry.create({ data: { metricId: b.metric.id, value: Math.round(input.weightKg * 10) / 10 } })
    undo.push({ kind: "DELETE_METRIC_ENTRY", entryId: entry.id })
    line = weightLine(b.metric.entries.length ? b.lastWeight : null, entry.value, b.metric.unit)
  }

  const ev = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "PROJECT",
    itemId: b.plan.meta.goalId ?? null,
    title: `Sunday check-in: ${b.done} of ${b.planned}`,
    source: "APP",
    undo: { kind: "MANY", items: undo },
  })
  return { ...(await previewCheckinService(userId)), weightLine: line, activityId: ev?.id ?? null, checkedOn: utcDayKey(dateFromKey(b.c.todayKey)) }
}
