/* =====================================================================
   The proactive agenda (ADR 0027): today's and tomorrow's briefing, slot
   nudges, wrap-up and Sunday review, built from the same plan as Now and
   Plan. The phone fetches this and schedules it as local notifications,
   so it works without push, on the free server, and offline once fetched.
   ===================================================================== */
import type { ActivitySource } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { addUtcDays, dateFromKey, localDayStartMs, utcDayKey } from "../../shared/utils/time.util.js"
import { agendaForDay, PROACTIVITY, wakeMin, type AgendaDayInput, type AgendaItem, type Proactivity } from "./agenda.rules.js"
import { formatAmount } from "./brain.rules.js"
import { mondayOf, weeklyTargets } from "./brain.service.js"
import { suggestDay, type DayBlock, type Mode } from "./now.rules.js"
import { getClock, getDay, getMode, lastActiveGapDays, loadCandidates, type Clock } from "./now.service.js"

export interface AgendaDto {
  level: Proactivity
  mode: Mode
  items: (AgendaItem & { at: string })[]
}

const nextKey = (key: string) => utcDayKey(addUtcDays(dateFromKey(key), 1))

// A clock for another local day at a given minute (tomorrow's plan, made tonight).
const clockFor = (tz: string, dayKey: string, min: number): Clock => {
  const d = dateFromKey(dayKey)
  return { tz, now: new Date(localDayStartMs(dayKey, tz) + min * 60_000), todayKey: dayKey, nowMin: min, weekday: d.getUTCDay(), dayOfMonth: d.getUTCDate() }
}

const DONE_TYPES = ["DONE", "MINIMUM", "LOGGED"] as const

const doneOn = async (userId: string, c: Clock): Promise<string[]> => {
  const rows = await prisma.activityEvent.findMany({
    where: { userId, type: { in: [...DONE_TYPES] }, undoneAt: null, source: { not: "SYSTEM" }, reason: { not: "PREP" }, at: { gte: new Date(localDayStartMs(c.todayKey, c.tz)), lte: c.now } },
    orderBy: { at: "desc" },
    select: { title: true },
  })
  return [...new Set(rows.map((r) => (r.title ?? "").trim()).filter(Boolean))]
}

const dueSoon = async (userId: string, c: Clock): Promise<AgendaDayInput["due"]> => {
  const tomorrow = nextKey(c.todayKey)
  const rows = await prisma.task.findMany({
    where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null, remindAt: null, dueDate: { gte: dateFromKey(c.todayKey), lte: dateFromKey(tomorrow) } },
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
    take: 5,
    select: { title: true, dueDate: true },
  })
  return rows.map((r) => ({ title: r.title, when: utcDayKey(r.dueDate!) === c.todayKey ? ("today" as const) : ("tomorrow" as const) }))
}

// "DSA: 5 of 6 h", "Applications: 8 of 10", "Gym: 3 times" for the Sunday review.
const weekLines = async (userId: string, c: Clock): Promise<string[]> => {
  const targets = await weeklyTargets(userId, c)
  const lines = targets.map((t) =>
    t.unit === "count"
      ? `${t.title}: ${Math.round(t.doneThisWeek)} of ${formatAmount(t.target, t.unit, t.countUnit)}`
      : `${t.title}: ${formatAmount(t.doneThisWeek, t.unit, null)} of ${formatAmount(t.target, t.unit, null)}`,
  )
  const monday = mondayOf(c.todayKey)
  const logs = await prisma.habitLog.groupBy({
    by: ["habitId"],
    where: { habit: { userId, isActive: true }, completed: true, date: { gte: dateFromKey(monday.key), lte: dateFromKey(c.todayKey) } },
    _count: { _all: true },
  })
  if (logs.length) {
    const habits = await prisma.habit.findMany({ where: { id: { in: logs.map((l) => l.habitId) } }, select: { id: true, title: true } })
    const name = new Map(habits.map((h) => [h.id, h.title]))
    for (const l of logs.sort((a, b) => b._count._all - a._count._all)) {
      lines.push(`${name.get(l.habitId) ?? "Habit"}: ${l._count._all} time${l._count._all === 1 ? "" : "s"}`)
    }
  }
  return lines
}

const dayInput = async (
  userId: string,
  c: Clock,
  o: { isToday: boolean; blocks: DayBlock[]; mode: Mode; level: Proactivity; busyUntil: Date | null; wrapUpAt: string | null },
): Promise<AgendaDayInput> => {
  const busyUntilMin =
    o.busyUntil && o.busyUntil.getTime() > c.now.getTime() ? Math.round((o.busyUntil.getTime() - localDayStartMs(c.todayKey, c.tz)) / 60_000) : null
  const [gapDays, candidates, due, done, week] = await Promise.all([
    lastActiveGapDays(userId, c),
    loadCandidates(userId, c),
    dueSoon(userId, c),
    o.isToday ? doneOn(userId, c) : Promise.resolve([]),
    c.weekday === 0 ? weekLines(userId, c) : Promise.resolve([]),
  ])
  const suggested = suggestDay({
    nowMin: Math.max(c.nowMin, busyUntilMin ?? -1),
    todayKey: c.todayKey,
    weekday: c.weekday,
    dayOfMonth: c.dayOfMonth,
    blocks: o.blocks,
    mode: o.mode,
    gapDays,
    candidates,
  })
  const left = suggested.flatMap((b) => b.items.map((i) => i.title))
  for (const d of due) if (d.when === "today" && !left.includes(d.title)) left.push(d.title)
  return {
    dayKey: c.todayKey,
    weekday: c.weekday,
    nowMin: c.nowMin,
    isToday: o.isToday,
    blocks: o.blocks,
    suggested,
    mode: o.mode,
    level: o.level,
    busyUntilMin,
    wrapUpAt: o.wrapUpAt,
    due,
    doneToday: done,
    leftToday: o.isToday ? left : [],
    week,
  }
}

export const getAgendaService = async (userId: string, at?: string): Promise<AgendaDto> => {
  const c = await getClock(userId, at)
  const tomorrowKey = nextKey(c.todayKey)
  const tomorrowWeekday = dateFromKey(tomorrowKey).getUTCDay()
  const [settings, { mode }, todayBlocks, tomorrowBlocks] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId }, select: { proactivity: true, nightlyTime: true, busyUntil: true } }),
    getMode(userId, c.now),
    getDay(userId, c.weekday),
    getDay(userId, tomorrowWeekday),
  ])
  const level: Proactivity = PROACTIVITY.includes(settings?.proactivity as Proactivity) ? (settings!.proactivity as Proactivity) : "NORMAL"
  const common = { mode, level, wrapUpAt: settings?.nightlyTime ?? null }
  const tomorrowClock = clockFor(c.tz, tomorrowKey, Math.max(0, wakeMin(tomorrowBlocks) - 1))
  const [today, tomorrow] = await Promise.all([
    dayInput(userId, c, { ...common, isToday: true, blocks: todayBlocks, busyUntil: settings?.busyUntil ?? null }),
    dayInput(userId, tomorrowClock, { ...common, isToday: false, blocks: tomorrowBlocks, busyUntil: null }),
  ])
  const items = [...agendaForDay(today), ...agendaForDay(tomorrow)].map((i) => ({
    ...i,
    at: new Date(localDayStartMs(i.dayKey, c.tz) + i.atMin * 60_000).toISOString(),
  }))
  return { level, mode, items }
}

// "What's my day?": the rest of today, from the same plan as the agenda.
export const restOfTodayService = async (userId: string, at?: string) => {
  const c = await getClock(userId, at)
  const [settings, { mode }, blocks] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId }, select: { proactivity: true, nightlyTime: true, busyUntil: true } }),
    getMode(userId, c.now),
    getDay(userId, c.weekday),
  ])
  const busyUntil = settings?.busyUntil && settings.busyUntil.getTime() > c.now.getTime() ? settings.busyUntil : null
  const [input, reminders] = await Promise.all([
    dayInput(userId, c, { mode, level: "NORMAL", wrapUpAt: settings?.nightlyTime ?? null, isToday: true, blocks, busyUntil }),
    prisma.task.findMany({
      where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null, remindAt: { gte: c.now, lt: new Date(localDayStartMs(nextKey(c.todayKey), c.tz)) } },
      orderBy: { remindAt: "asc" },
      take: 8,
      select: { title: true, remindAt: true },
    }),
  ])
  return { c, input, reminders, busyUntil }
}

export const setProactivityService = async (userId: string, level: Proactivity) => {
  await prisma.userSettings.upsert({ where: { userId }, update: { proactivity: level }, create: { userId, proactivity: level, enabledModules: [] } })
  return { level }
}

// The wrap-up's "Move to tomorrow": today's open dated to-dos move one day,
// in one undoable step. Weekly-target sessions and habits need no moving;
// tomorrow's plan picks them up by itself.
export const moveLeftToTomorrowService = async (userId: string, at?: string, source: ActivitySource = "APP") => {
  const c = await getClock(userId, at)
  const rows = await prisma.task.findMany({
    where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null, remindAt: null, dueDate: { lte: dateFromKey(c.todayKey) } },
    select: { id: true, dueDate: true },
  })
  if (!rows.length) return { moved: 0, activityId: null, message: "Nothing to move. Tomorrow starts fresh." }
  await prisma.task.updateMany({ where: { userId, id: { in: rows.map((r) => r.id) } }, data: { dueDate: dateFromKey(nextKey(c.todayKey)) } })
  const ev = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "TASK",
    title: `Moved ${rows.length} to tomorrow`,
    source,
    undo: { kind: "RESTORE_DUE", items: rows.map((r) => ({ taskId: r.id, prev: r.dueDate ? r.dueDate.toISOString() : null })) },
  })
  return { moved: rows.length, activityId: ev?.id ?? null, message: `Moved ${rows.length} to tomorrow. Rest well.` }
}
