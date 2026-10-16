/* =====================================================================
   The brain's data: weekly targets with this week's progress, what was
   put off, and how long each area has been left alone. All of it is
   derived from the activity log (ADR 0005), nothing is stored twice.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { dayKeyInTz, localDayStartMs, utcDayKey } from "../../shared/utils/time.util.js"
import { effectiveTier, type Block } from "./now.rules.js"
import type { WeeklyTarget } from "./brain.rules.js"
import type { Tier } from "../guide/guide.rules.js"
import type { Clock } from "./now.service.js"

const DAY = 86_400_000
const DEFAULT_TASK_MINUTES = 25
const BLOCKS = ["MORNING", "COMMUTE", "OFFICE", "GYM", "EVENING", "NIGHT"]

// Monday of this week, local (weeks start on Monday).
export const mondayOf = (todayKey: string): { key: string; daysElapsed: number } => {
  const d = new Date(`${todayKey}T00:00:00Z`)
  const daysElapsed = (d.getUTCDay() + 6) % 7
  return { key: new Date(d.getTime() - daysElapsed * DAY).toISOString().slice(0, 10), daysElapsed }
}

// Every active project with a weekly target, and how far along this week is.
// Minutes count from logged practice and from the project's to-dos done this
// week; counts come from logged amounts ("applied to 2").
export const weeklyTargets = async (userId: string, c: Clock): Promise<WeeklyTarget[]> => {
  const projects = await prisma.project.findMany({
    where: { userId, status: "ACTIVE", OR: [{ weeklyTargetMinutes: { gt: 0 } }, { weeklyTargetCount: { gt: 0 } }] },
    include: { area: { select: { name: true, tier: true, laterUntil: true } }, goal: { select: { title: true, deadline: true, status: true } } },
  })
  if (!projects.length) return []
  const monday = mondayOf(c.todayKey)
  const weekStart = new Date(localDayStartMs(monday.key, c.tz))
  const dayStart = new Date(localDayStartMs(c.todayKey, c.tz))
  const ids = projects.map((p) => p.id)
  const [logs, tasksDone] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { userId, type: { in: ["LOGGED", "DONE", "MINIMUM"] }, itemType: "PROJECT", itemId: { in: ids }, undoneAt: null, at: { gte: weekStart } },
      select: { itemId: true, minutes: true, value: true, at: true },
    }),
    prisma.task.findMany({
      where: { userId, projectId: { in: ids }, status: "COMPLETED", completedAt: { gte: weekStart } },
      select: { projectId: true, sizeMinutes: true, completedAt: true },
    }),
  ])

  return projects.map((p) => {
    const unit: "min" | "count" = p.weeklyTargetMinutes && p.weeklyTargetMinutes > 0 ? "min" : "count"
    let week = 0
    let today = 0
    for (const e of logs.filter((l) => l.itemId === p.id)) {
      const amount = unit === "min" ? (e.minutes ?? 0) : (e.value ?? 0)
      week += amount
      if (e.at >= dayStart) today += amount
    }
    if (unit === "min") {
      for (const t of tasksDone.filter((x) => x.projectId === p.id)) {
        const m = t.sizeMinutes ?? DEFAULT_TASK_MINUTES
        week += m
        if (t.completedAt && t.completedAt >= dayStart) today += m
      }
    }
    const deadline = p.deadline ?? (p.goal?.status === "ACTIVE" ? p.goal.deadline : null)
    // Set this week? Only the days since then count, so a plan made on Friday
    // asks for Friday to Sunday's share, not a whole week squeezed into three days.
    const fullTarget = unit === "min" ? p.weeklyTargetMinutes! : p.weeklyTargetCount!
    const setOn = p.createdAt >= weekStart ? Math.min(6, Math.max(0, Math.floor((p.createdAt.getTime() - weekStart.getTime()) / DAY))) : 0
    const weekDays = 7 - setOn
    return {
      projectId: p.id,
      title: p.title,
      unit,
      countUnit: p.countUnit,
      target: setOn ? Math.max(1, Math.round((fullTarget * weekDays) / 7)) : fullTarget,
      doneThisWeek: week,
      doneToday: today,
      daysElapsed: Math.max(0, monday.daysElapsed - setOn),
      weekDays,
      sessionMinutes: p.sessionMinutes,
      block: p.timeBlock && BLOCKS.includes(p.timeBlock) ? (p.timeBlock as Block) : null,
      tier: effectiveTier(p.area.tier as Tier, p.area.laterUntil, c.now),
      areaName: p.area.name,
      deadlineKey: deadline ? utcDayKey(deadline) : null,
      goalTitle: p.goal?.title ?? null,
    }
  })
}

// Items put off today, and how often each was put off in the last 14 days.
export const skipsOf = async (userId: string, c: Clock): Promise<{ today: Set<string>; last14: Map<string, number> }> => {
  const dayStart = new Date(localDayStartMs(c.todayKey, c.tz))
  const rows = await prisma.activityEvent.findMany({
    where: { userId, type: "SKIPPED", itemId: { not: null }, undoneAt: null, at: { gte: new Date(c.now.getTime() - 14 * DAY) } },
    select: { itemId: true, at: true },
  })
  const today = new Set<string>()
  const last14 = new Map<string, number>()
  for (const r of rows) {
    last14.set(r.itemId!, (last14.get(r.itemId!) ?? 0) + 1)
    if (r.at >= dayStart) today.add(r.itemId!)
  }
  return { today, last14 }
}

// Days since anything in each area was done (14 = "two weeks or more").
export const areaIdleDays = async (userId: string, c: Clock): Promise<Map<string, number>> => {
  const since = new Date(c.now.getTime() - 14 * DAY)
  const [tasks, logs, projectEvents] = await Promise.all([
    prisma.task.findMany({ where: { userId, status: "COMPLETED", completedAt: { gte: since }, areaId: { not: null } }, select: { areaId: true, completedAt: true } }),
    prisma.habitLog.findMany({ where: { userId, completed: true, date: { gte: since } }, select: { date: true, habit: { select: { areaId: true } } } }),
    prisma.activityEvent.findMany({ where: { userId, itemType: "PROJECT", type: { in: ["LOGGED", "DONE", "MINIMUM"] }, undoneAt: null, at: { gte: since } }, select: { itemId: true, at: true } }),
  ])
  const projects = projectEvents.length
    ? await prisma.project.findMany({ where: { userId, id: { in: [...new Set(projectEvents.map((e) => e.itemId!))] } }, select: { id: true, areaId: true } })
    : []
  const projectArea = new Map(projects.map((p) => [p.id, p.areaId]))
  const last = new Map<string, Date>()
  const seen = (areaId: string | null | undefined, at: Date | null) => {
    if (!areaId || !at) return
    const prev = last.get(areaId)
    if (!prev || at > prev) last.set(areaId, at)
  }
  for (const t of tasks) seen(t.areaId, t.completedAt)
  for (const l of logs) seen(l.habit.areaId, l.date)
  for (const e of projectEvents) seen(projectArea.get(e.itemId!), e.at)
  const areas = await prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true } })
  const out = new Map<string, number>()
  for (const a of areas) {
    const at = last.get(a.id)
    out.set(a.id, at ? Math.max(0, Math.round((localDayStartMs(c.todayKey, c.tz) - localDayStartMs(dayKeyInTz(at, c.tz), c.tz)) / DAY)) : 14)
  }
  return out
}

// Saves made today, and how many of them already became something.
export const savesToday = async (userId: string, c: Clock): Promise<{ made: number; acted: number }> => {
  const rows = await prisma.capture.findMany({
    where: { userId, createdAt: { gte: new Date(localDayStartMs(c.todayKey, c.tz)) }, detectedUrl: { not: null } },
    select: { status: true },
  })
  return { made: rows.length, acted: rows.filter((r) => r.status === "CONVERTED").length }
}
