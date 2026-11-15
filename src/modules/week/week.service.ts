// GET /week: the Week tab in one call. Reads only.

import prisma from "../../lib/prisma.js"
import { getClock } from "../now/now.service.js"
import { getAreasOverviewService } from "../area/area.overview.service.js"
import { weekStartKey } from "../area/area.overview.rules.js"
import { dateFromKey, dayKeyInTz, utcDayKey } from "../../shared/utils/time.util.js"
import { DAY_LABELS, DayTally, lookBackMonth, routineDots, routineLine, weekKeys, weekLabel, type Dot } from "./week.rules.js"

export interface WeekDto {
  weekStart: string
  label: string
  todayKey: string
  days: { key: string; label: string; done: { areaId: string; minutes: number }[]; planned: { areaId: string; minutes: number }[] }[]
  routines: { id: string; title: string; areaId: string; dots: Dot[]; line: string }[]
  areas: { id: string; name: string; mode: string; minutes: number; plannedMinutes: number }[]
  lookBack: { month: string; totalMinutes: number; byArea: { areaId: string; name: string; minutes: number }[] } | null
}

// Minutes per area per day between two days (inclusive), from everything that was done.
const doneMinutes = async (userId: string, tz: string, from: string, to: string) => {
  const start = dateFromKey(from)
  const end = new Date(dateFromKey(to).getTime() + 86_400_000)
  const [tasks, logs, timed, sessions, projects] = await Promise.all([
    prisma.task.findMany({
      where: { userId, status: "COMPLETED", completedAt: { gte: new Date(start.getTime() - 86_400_000), lt: new Date(end.getTime() + 86_400_000) } },
      select: { id: true, areaId: true, projectId: true, sizeMinutes: true, targetMinutes: true, completedAt: true, goal: { select: { areaId: true } } },
    }),
    prisma.habitLog.findMany({
      where: { userId, completed: true, date: { gte: start, lt: end }, habit: { isLimit: false } },
      select: { habitId: true, date: true, minutes: true, habit: { select: { areaId: true, targetMinutes: true } } },
    }),
    prisma.timeEntry.findMany({ where: { userId, date: { gte: start, lt: end }, minutes: { not: null }, itemId: { not: null } }, select: { itemType: true, itemId: true, minutes: true, date: true } }),
    prisma.activityEvent.findMany({
      where: { userId, type: "LOGGED", itemType: "PROJECT", undoneAt: null, minutes: { not: null }, at: { gte: new Date(start.getTime() - 86_400_000), lt: new Date(end.getTime() + 86_400_000) } },
      select: { itemId: true, minutes: true, at: true },
    }),
    prisma.project.findMany({ where: { userId }, select: { id: true, areaId: true } }),
  ])
  const areaOfProject = new Map(projects.map((p) => [p.id, p.areaId]))
  const areaOfTask = new Map(tasks.map((t) => [t.id, t.areaId ?? t.goal?.areaId ?? (t.projectId ? areaOfProject.get(t.projectId) ?? null : null)]))
  const inRange = (k: string) => k >= from && k <= to
  const tally = new DayTally()
  for (const t of tasks) {
    const k = dayKeyInTz(t.completedAt!, tz)
    const a = areaOfTask.get(t.id)
    if (a && inRange(k)) tally.add(a, k, `TASK:${t.id}`, t.sizeMinutes ?? t.targetMinutes ?? 0, "logged")
  }
  for (const l of logs) {
    const k = utcDayKey(l.date)
    if (inRange(k)) tally.add(l.habit.areaId, k, `HABIT:${l.habitId}`, l.minutes > 0 ? l.minutes : l.habit.targetMinutes ?? 0, "logged")
  }
  const habitArea = new Map(logs.map((l) => [l.habitId, l.habit.areaId]))
  for (const e of timed) {
    const k = utcDayKey(e.date)
    const a = e.itemType === "PROJECT" ? areaOfProject.get(e.itemId!) : e.itemType === "HABIT" ? habitArea.get(e.itemId!) : areaOfTask.get(e.itemId!)
    if (a && inRange(k)) tally.add(a, k, `${e.itemType}:${e.itemId}`, e.minutes ?? 0, "timed")
  }
  for (const s of sessions) {
    const k = dayKeyInTz(s.at, tz)
    const a = s.itemId ? areaOfProject.get(s.itemId) : null
    if (a && inRange(k)) tally.add(a, k, `PROJECT:${s.itemId}`, s.minutes ?? 0, "logged")
  }
  return tally.byAreaAndDay()
}

export const getWeekService = async (userId: string, at?: string): Promise<WeekDto> => {
  const c = await getClock(userId, at)
  const todayKey = c.todayKey
  const weekStart = weekStartKey(todayKey)
  const keys = weekKeys(weekStart)
  const back = lookBackMonth(todayKey)

  const [overview, done, monthDone, open, habits] = await Promise.all([
    getAreasOverviewService(userId, c.now),
    doneMinutes(userId, c.tz, keys[0]!, keys[6]!),
    back ? doneMinutes(userId, c.tz, back.from, back.to) : Promise.resolve(null),
    prisma.task.findMany({
      where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null, dueDate: { gte: dateFromKey(todayKey), lt: new Date(dateFromKey(keys[6]!).getTime() + 86_400_000) } },
      select: { areaId: true, dueDate: true, sizeMinutes: true, targetMinutes: true, goal: { select: { areaId: true } } },
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true, isLimit: false },
      select: { id: true, title: true, areaId: true, frequency: true, specificDays: true, weeklyTarget: true, targetMinutes: true, logs: { where: { completed: true, date: { gte: dateFromKey(keys[0]!), lte: dateFromKey(keys[6]!) } }, select: { date: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ])

  const resting = new Set(overview.areas.filter((a) => a.mode === "REST").map((a) => a.id))
  const known = new Set(overview.areas.map((a) => a.id))

  // Planned, for today and the days ahead: to-dos due that day and routines meant for it, not yet done.
  const planned = new Map<string, Map<string, number>>()
  const plan = (areaId: string | null | undefined, k: string, m: number) => {
    if (!areaId || !known.has(areaId) || resting.has(areaId) || m <= 0) return
    if (!planned.has(k)) planned.set(k, new Map())
    const d = planned.get(k)!
    d.set(areaId, (d.get(areaId) ?? 0) + m)
  }
  for (const t of open) plan(t.areaId ?? t.goal?.areaId, utcDayKey(t.dueDate!), t.sizeMinutes ?? t.targetMinutes ?? 15)

  const routines: WeekDto["routines"] = []
  for (const h of habits) {
    if (!known.has(h.areaId)) continue
    const doneKeys = new Set(h.logs.map((l) => utcDayKey(l.date)))
    const dots = routineDots(h, doneKeys, keys, todayKey)
    dots.forEach((d, i) => {
      if (d === "PLANNED") plan(h.areaId, keys[i]!, h.targetMinutes ?? 10)
    })
    routines.push({ id: h.id, title: h.title, areaId: h.areaId, dots, line: routineLine(h, dots) })
  }

  const days: WeekDto["days"] = keys.map((k, i) => ({
    key: k,
    label: DAY_LABELS[i]!,
    done: overview.areas.map((a) => ({ areaId: a.id, minutes: done.get(a.id)?.get(k) ?? 0 })).filter((x) => x.minutes > 0),
    planned: k < todayKey ? [] : overview.areas.map((a) => ({ areaId: a.id, minutes: planned.get(k)?.get(a.id) ?? 0 })).filter((x) => x.minutes > 0),
  }))

  let lookBack: WeekDto["lookBack"] = null
  if (back && monthDone) {
    const byArea = overview.areas
      .map((a) => ({ areaId: a.id, name: a.name, minutes: [...(monthDone.get(a.id)?.values() ?? [])].reduce((s, m) => s + m, 0) }))
      .filter((x) => x.minutes > 0)
      .sort((x, y) => y.minutes - x.minutes)
    const total = byArea.reduce((s, x) => s + x.minutes, 0)
    if (total > 0) lookBack = { month: back.month, totalMinutes: total, byArea }
  }

  return {
    weekStart,
    label: weekLabel(weekStart),
    todayKey,
    days,
    routines,
    areas: overview.areas.map((a) => ({ id: a.id, name: a.name, mode: a.mode, minutes: a.minutes, plannedMinutes: a.plannedMinutes })),
    lookBack,
  }
}
