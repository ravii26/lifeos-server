// GET /areas/overview: where every area stands this week, in one call.
// Reads only; the words and numbers come from area.overview.rules.ts.

import prisma from "../../lib/prisma.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import { getScheduleService } from "../now/now.service.js"
import { addUtcDays, dateFromKey, dayKeyInTz, todayKeyInTz, utcDayKey } from "../../shared/utils/time.util.js"
import { tasteRounds } from "../taste/taste.service.js"
import { TASTES_KIND } from "../taste/taste.rules.js"
import { capacity, itemMinutes, modeOfTier, reworking, standing, weekStartKey, type AreaMode, type Capacity } from "./area.overview.rules.js"
import { applyPlannedModes } from "./area.planned.service.js"
import { metricStand } from "../progress/progress.rules.js"
import { lastPoints } from "../number/number.rules.js"
import { kindOf, whenWords } from "../step/when.rules.js"
import { progressOf } from "../milestone/milestone.service.js"
import type { GoalProgress, MilestoneState } from "../milestone/milestone.rules.js"

// How far back "last touched" looks.
const LOOKBACK_DAYS = 60
const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

export interface AreaOverviewItem {
  id: string
  name: string
  color: string
  icon: string
  order: number
  mode: AreaMode
  weeklyMinutes: number | null
  restUntil: string | null
  plannedMinutes: number
  minutes: number
  doneCount: number
  value: number
  status: string
  goals: {
    id: string
    title: string
    // Milestones (5.0 #44), or null for a goal without them.
    milestones: { id: string; title: string; state: MilestoneState; stepsDone: number; stepsTotal: number }[] | null
    progress: { index: number; total: number; reached: number; ready: boolean; currentId: string | null; line: string } | null
  }[]
  // The first goal's milestone line, shown under the area: "Milestone 2 of 5: … · 3 of 6 steps done".
  progressLine: string | null
  nextSteps: { id: string; title: string; minutes: number | null; dueKey: string | null; dueKind: "ON" | "BY" | null; windowFrom: string | null; windowTo: string | null; when: string | null; energy: string | null; smaller: string | null }[]
  routines: { id: string; title: string; doneThisWeek: number }[]
  // Three small tastes going in this area, or null.
  tastes: { done: number; total: number; decide: boolean } | null
  // A mode change planned for a day, or null.
  planned: { mode: AreaMode; on: string } | null
  // Steps here reworked three or more times since anything was done: one gentle line.
  reworking: boolean
  // Tracked numbers: where each started, is, and is going, with the last readings.
  numbers: {
    projectId: string
    name: string
    unit: string
    start: number
    latest: number
    target: number
    percent: number
    weeklyChange: number | null
    trend: string
    message: string
    points: { value: number; at: string }[]
  }[]
}

export interface AreasOverview {
  weekStart: string
  areas: AreaOverviewItem[]
  capacity: Capacity
}

export const getAreasOverviewService = async (userId: string, now: Date = new Date()): Promise<AreasOverview> => {
  // A mode change planned for today or earlier happens before anything is read.
  await applyPlannedModes(userId, now)
  const tz = await getUserTimezone(userId)
  const todayKey = todayKeyInTz(tz, now)
  const weekStart = weekStartKey(todayKey)
  const since = addUtcDays(dateFromKey(todayKey), -LOOKBACK_DAYS)

  const [areas, tasks, habits, projects, goals, timed, sessions, schedule, rounds, edits] = await Promise.all([
    prisma.area.findMany({ where: { userId, isActive: true }, orderBy: { order: "asc" } }),
    prisma.task.findMany({
      where: { userId, archivedAt: null, OR: [{ status: { in: ["TODO", "IN_PROGRESS"] } }, { completedAt: { gte: since } }] },
      select: { id: true, areaId: true, projectId: true, goalId: true, title: true, status: true, priority: true, dueDate: true, dueKind: true, windowFrom: true, windowTo: true, sizeMinutes: true, targetMinutes: true, completedAt: true, energy: true, minimumVersion: true },
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true },
      select: { id: true, areaId: true, title: true, targetMinutes: true, isLimit: true, logs: { where: { date: { gte: since }, completed: true }, select: { date: true, minutes: true } } },
    }),
    prisma.project.findMany({
      where: { userId, status: "ACTIVE" },
      select: { id: true, areaId: true, weeklyTargetMinutes: true, kind: true, metric: { include: { entries: { orderBy: { at: "desc" }, take: 60 } } } },
    }),
    // A round of tastes is not a goal to show; it is reported as `tastes` below.
    prisma.goal.findMany({ where: { userId, status: "ACTIVE", parentId: null, OR: [{ kind: null }, { kind: { not: TASTES_KIND } }] }, select: { id: true, areaId: true, title: true }, orderBy: { createdAt: "asc" } }),
    prisma.timeEntry.findMany({
      where: { userId, date: { gte: since }, minutes: { not: null }, itemId: { not: null } },
      select: { itemType: true, itemId: true, minutes: true, date: true },
    }),
    // Minutes said or logged towards a goal ("did 40 min of guitar").
    prisma.activityEvent.findMany({
      where: { userId, type: "LOGGED", itemType: "PROJECT", undoneAt: null, minutes: { not: null }, at: { gte: since } },
      select: { itemId: true, minutes: true, at: true },
    }),
    getScheduleService(userId),
    tasteRounds(userId),
    // Step edits and moves this week, for "reworking without doing".
    prisma.activityEvent.findMany({
      where: { userId, type: "UPDATED", itemType: "TASK", undoneAt: null, at: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
      select: { itemId: true, at: true },
    }),
  ])

  // Milestones of each goal; steps of milestones not yet open (or already reached) are not next steps.
  const progress = await progressOf(userId, goals.map((g) => g.id))
  const waiting = new Set<string>()
  for (const p of progress.values()) for (const m of p.milestones) if (m.state !== "CURRENT") waiting.add(m.id)
  const goalView = (g: { id: string; title: string }): AreaOverviewItem["goals"][number] => {
    const p: GoalProgress | undefined = progress.get(g.id)
    return {
      id: g.id,
      title: g.title,
      milestones: p ? p.milestones.map((m) => ({ id: m.id, title: m.title, state: m.state, stepsDone: m.stepsDone, stepsTotal: m.stepsTotal })) : null,
      progress: p ? { index: p.index, total: p.total, reached: p.reached, ready: p.ready, currentId: p.current?.id ?? null, line: p.line } : null,
    }
  }

  const areaOfProject = new Map(projects.map((p) => [p.id, p.areaId]))
  const areaOfTask = new Map(tasks.map((t) => [t.id, t.areaId ?? (t.projectId ? areaOfProject.get(t.projectId) ?? null : null)]))
  const areaOfHabit = new Map(habits.map((h) => [h.id, h.areaId]))

  // Per area: minutes per item this week (timed and logged kept apart so one
  // thing is not counted twice), the days something happened, the last day.
  interface Tally { timed: Map<string, number>; logged: Map<string, number>; days: Set<string>; last: string | null; done: number }
  const tallies = new Map<string, Tally>()
  const tallyOf = (areaId: string): Tally => {
    let t = tallies.get(areaId)
    if (!t) tallies.set(areaId, (t = { timed: new Map(), logged: new Map(), days: new Set(), last: null, done: 0 }))
    return t
  }
  const touch = (areaId: string | null | undefined, dayKey: string, item: string, minutes: number, kind: "timed" | "logged", counts: boolean) => {
    if (!areaId) return
    const t = tallyOf(areaId)
    if (!t.last || dayKey > t.last) t.last = dayKey
    if (dayKey < weekStart || dayKey > todayKey) return
    t.days.add(dayKey)
    if (counts) t.done++
    t[kind].set(item, (t[kind].get(item) ?? 0) + minutes)
  }

  for (const t of tasks) {
    if (t.status !== "COMPLETED" || !t.completedAt) continue
    touch(areaOfTask.get(t.id), dayKeyInTz(t.completedAt, tz), `TASK:${t.id}`, t.sizeMinutes ?? t.targetMinutes ?? 0, "logged", true)
  }
  for (const h of habits) {
    // A limit ("less than 2 coffees") is not time given to the area.
    if (h.isLimit) continue
    for (const l of h.logs) touch(h.areaId, utcDayKey(l.date), `HABIT:${h.id}`, l.minutes > 0 ? l.minutes : h.targetMinutes ?? 0, "logged", true)
  }
  for (const e of timed) {
    const areaId = e.itemType === "PROJECT" ? areaOfProject.get(e.itemId!) : e.itemType === "HABIT" ? areaOfHabit.get(e.itemId!) : areaOfTask.get(e.itemId!)
    touch(areaId, utcDayKey(e.date), `${e.itemType}:${e.itemId}`, e.minutes ?? 0, "timed", false)
  }
  for (const s of sessions) {
    if (!s.itemId) continue
    touch(areaOfProject.get(s.itemId), dayKeyInTz(s.at, tz), `PROJECT:${s.itemId}`, s.minutes ?? 0, "logged", true)
  }

  // When anything was last done in each area, to the minute where known.
  const lastDoneAt = new Map<string, number>()
  const doneAt = (areaId: string | null | undefined, ms: number) => {
    if (areaId && ms > (lastDoneAt.get(areaId) ?? 0)) lastDoneAt.set(areaId, ms)
  }
  for (const t of tasks) if (t.status === "COMPLETED" && t.completedAt) doneAt(areaOfTask.get(t.id), t.completedAt.getTime())
  for (const s of sessions) if (s.itemId) doneAt(areaOfProject.get(s.itemId), s.at.getTime())
  for (const h of habits) for (const l of h.logs) doneAt(h.areaId, l.date.getTime())

  const items: AreaOverviewItem[] = areas.map((a) => {
    const t = tallies.get(a.id)
    let minutes = 0
    if (t) for (const key of new Set([...t.timed.keys(), ...t.logged.keys()])) minutes += itemMinutes(t.timed.get(key) ?? 0, t.logged.get(key) ?? 0)
    const mode = modeOfTier(a.tier)
    const restUntil = a.laterUntil ? dayKeyInTz(a.laterUntil, tz) : null
    const stand = standing({
      mode,
      weeklyMinutes: a.weeklyMinutes,
      projectMinutes: projects.filter((p) => p.areaId === a.id).reduce((s, p) => s + (p.weeklyTargetMinutes ?? 0), 0),
      minutes,
      activeDays: t?.days.size ?? 0,
      lastKey: t?.last ?? null,
      todayKey,
      restUntilKey: restUntil,
    })
    const open = tasks
      .filter((x) => (x.status === "TODO" || x.status === "IN_PROGRESS") && areaOfTask.get(x.id) === a.id && !(x.goalId && waiting.has(x.goalId)))
      .sort((x, y) => {
        // Dated first and soonest first, then by priority.
        const dx = x.dueDate?.getTime() ?? Number.POSITIVE_INFINITY
        const dy = y.dueDate?.getTime() ?? Number.POSITIVE_INFINITY
        return dx !== dy ? dx - dy : (PRIORITY_RANK[x.priority] ?? 2) - (PRIORITY_RANK[y.priority] ?? 2)
      })
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      icon: a.icon,
      order: a.order,
      mode,
      weeklyMinutes: a.weeklyMinutes,
      restUntil,
      plannedMinutes: stand.plannedMinutes,
      minutes,
      doneCount: t?.done ?? 0,
      value: stand.value,
      status: stand.status,
      goals: goals.filter((g) => g.areaId === a.id).map(goalView),
      progressLine: goals.filter((g) => g.areaId === a.id).map((g) => progress.get(g.id)?.line).find(Boolean) ?? null,
      nextSteps: open.slice(0, 3).map((x) => {
        const w = { dueKey: x.dueDate ? utcDayKey(x.dueDate) : null, dueKind: x.dueKind as "ON" | "BY" | null, windowFrom: x.windowFrom, windowTo: x.windowTo }
        // The kind is always said to the app (an older date with none reads as "by"), with the words to show.
        return { id: x.id, title: x.title, minutes: x.sizeMinutes ?? x.targetMinutes ?? null, ...w, dueKind: kindOf(w), when: whenWords(w, todayKey), energy: x.energy, smaller: x.minimumVersion }
      }),
      routines: habits
        .filter((h) => h.areaId === a.id && !h.isLimit)
        .map((h) => ({ id: h.id, title: h.title, doneThisWeek: h.logs.filter((l) => { const k = utcDayKey(l.date); return k >= weekStart && k <= todayKey }).length })),
      tastes: (() => {
        const r = rounds.get(a.id)
        return r ? { done: r.done, total: r.total, decide: r.decide } : null
      })(),
      planned: a.nextTier && a.nextTierOn ? { mode: modeOfTier(a.nextTier), on: utcDayKey(a.nextTierOn) } : null,
      numbers: projects
        .filter((p) => p.areaId === a.id && p.kind === "OUTCOME" && p.metric)
        .map((p) => {
          const m = p.metric!
          const s = metricStand({ name: m.name, unit: m.unit, startValue: m.startValue, targetValue: m.targetValue }, m.entries, now)
          return {
            projectId: p.id,
            name: m.name,
            unit: m.unit,
            start: s.start,
            latest: s.latest,
            target: s.target,
            percent: s.percent,
            weeklyChange: s.weeklyChange,
            trend: s.trend,
            message: s.message,
            points: lastPoints(m.entries),
          }
        }),
      reworking: reworking(
        edits.filter((e) => e.itemId && areaOfTask.get(e.itemId) === a.id).map((e) => e.at.getTime()),
        lastDoneAt.get(a.id) ?? null,
        now.getTime(),
      ),
    }
  })

  const freeMinutes = schedule.reduce((s, d) => s + (d.blocks ?? []).reduce((b, x) => b + (x.freeMinutes ?? 0), 0), 0)
  return { weekStart, areas: items, capacity: capacity(items, freeMinutes) }
}
