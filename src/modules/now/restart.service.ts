/* =====================================================================
   Restart after a gap (decisions log #14): what Now says on coming back,
   and the two things the person can choose: a light week for the plan,
   and moving plan sessions to the time of day that didn't keep failing.
   Both are offered, never done silently, and both have Undo.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { buildFitnessPlan, type FitnessAnswers } from "../weekplan/fitness.rules.js"
import { restartLevel, reasonInsight, recordLine, lightMinutes, type RestartLevel, type ReasonInsight } from "./restart.rules.js"

export interface RestartInfo {
  level: RestartLevel
  gapDays: number
  insight: ReasonInsight | null
  record: string | null
  canLightWeek: boolean // there is a weekly plan to make lighter
  resetup: boolean // 90+ days: offer to redo the season and sleep plan
}

interface PlanMeta {
  kind?: string
  habits?: Record<string, string>
  answers?: FitnessAnswers
  fullInARow?: number
  [k: string]: unknown
}

const fitnessPlan = async (userId: string) => {
  const notes = await prisma.allyNote.findMany({ where: { userId, collection: "Fitness", template: "PLAYBOOK" }, orderBy: { createdAt: "desc" }, take: 5 })
  for (const n of notes) {
    const m = (n.meta ?? {}) as PlanMeta
    if (m.kind === "WEEKPLAN_FITNESS" && m.habits) return { note: n, meta: m }
  }
  return null
}

const hourIn = (d: Date, tz: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d)) % 24

// Only worked out after a week or more away; a short gap needs no speech.
export const restartInfo = async (userId: string, gapDays: number, now: Date, tz: string): Promise<RestartInfo | null> => {
  const level = restartLevel(gapDays)
  if (level === "NONE" || level === "SHORT") return null
  const since = new Date(now.getTime() - (gapDays + 45) * 86_400_000)
  const [skips, done, plan] = await Promise.all([
    prisma.activityEvent.findMany({ where: { userId, type: "SKIPPED", at: { gte: since }, reason: { not: null } }, select: { reason: true, at: true }, take: 300 }),
    prisma.activityEvent.count({ where: { userId, type: { in: ["DONE", "MINIMUM", "LOGGED"] }, undoneAt: null } }),
    fitnessPlan(userId),
  ])
  const habitIds = plan ? Object.values(plan.meta.habits!) : []
  const workouts = habitIds.length ? await prisma.habitLog.count({ where: { userId, habitId: { in: habitIds }, completed: true } }) : 0
  return {
    level,
    gapDays,
    insight: reasonInsight(skips.map((s) => ({ reason: s.reason, hour: hourIn(s.at, tz) }))),
    record: recordLine(done, workouts),
    canLightWeek: !!plan,
    resetup: level === "VERY_LONG",
  }
}

// POST /now/restart: start the plan again lighter, and/or move its sessions
// to the time of day that didn't keep failing. One Undo for both.
export const applyRestartService = async (userId: string, input: { lightWeek?: boolean; switchTo?: "MORNING" | "EVENING" }) => {
  const plan = await fitnessPlan(userId)
  if (!plan) throw new ValidationError("There's no weekly plan to restart")
  const habits = await prisma.habit.findMany({ where: { userId, id: { in: Object.values(plan.meta.habits!) }, isActive: true } })
  // Week-1 days from the plan's own answers: a restart is a light week 1, never bigger.
  const week1 = plan.meta.answers ? Object.fromEntries(buildFitnessPlan(plan.meta.answers).sessions.map((s) => [s.key, s.week1Days])) : {}
  const keyOf = (id: string) => Object.entries(plan.meta.habits!).find(([, v]) => v === id)?.[0] ?? ""
  const undo: UndoPayload[] = []
  const changed: string[] = []
  for (const h of habits) {
    const data: { targetMinutes?: number; specificDays?: string[]; timeBlock?: string } = {}
    if (input.lightWeek) {
      const m = lightMinutes(h.targetMinutes ?? 30)
      if (m !== h.targetMinutes) data.targetMinutes = m
      const days = week1[keyOf(h.id)]
      if (days && days.length < h.specificDays.length) data.specificDays = days
    }
    if (input.switchTo && h.timeBlock !== input.switchTo) data.timeBlock = input.switchTo
    if (!Object.keys(data).length) continue
    undo.push({ kind: "RESTORE_FIELDS", model: "habit", id: h.id, prev: { targetMinutes: h.targetMinutes, specificDays: h.specificDays, timeBlock: h.timeBlock } })
    await prisma.habit.update({ where: { id: h.id }, data })
    changed.push(`${h.title}${data.targetMinutes ? `: ${data.targetMinutes} min` : ""}`)
  }
  if (input.lightWeek) {
    // The "two full weeks" count starts again too.
    undo.push({ kind: "RESTORE_FIELDS", model: "allyNote", id: plan.note.id, prev: { meta: plan.note.meta } })
    await prisma.allyNote.update({ where: { id: plan.note.id }, data: { meta: { ...plan.meta, fullInARow: 0 } as never } })
  }
  const message = [
    input.lightWeek ? "Light week 1: shorter sessions, fewer days." : null,
    input.switchTo ? `Sessions moved to ${input.switchTo === "MORNING" ? "mornings" : "evenings"}.` : null,
  ]
    .filter(Boolean)
    .join(" ")
  const ev = undo.length
    ? await recordActivity(userId, { type: "UPDATED", itemType: "PROJECT", title: `Restart: ${message}`, source: "APP", undo: { kind: "MANY", items: undo } })
    : null
  return { message: message || "Nothing needed changing.", changed, activityId: ev?.id ?? null }
}
