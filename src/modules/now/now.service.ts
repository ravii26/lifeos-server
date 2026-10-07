/* =====================================================================
   Right-now service: loads the person's real data, hands it to the pure
   rules (now.rules.ts) and applies the few side effects (mode, schedule,
   moving to-dos), each logged and undoable.
   ===================================================================== */
import type { ActivitySource, Prisma } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { localToUtc } from "../assistant/assistant.capture.js"
import { env } from "../../config/env.config.js"
import {
  dateFromKey,
  dayKeyInTz,
  daysBetweenKeys,
  localDayStartMs,
  utcDayKey,
} from "../../shared/utils/time.util.js"
import {
  capacityGuard,
  defaultDay,
  DEFAULT_SIZE,
  effectiveTier,
  normalizeDay,
  remainingFreeToday,
  rightNow,
  MODES,
  type Block,
  type CapacityResult,
  type DayBlock,
  type HabitSize,
  type Mode,
  type NowCandidate,
  type NowResult,
} from "./now.rules.js"
import type { Tier } from "../guide/guide.rules.js"

const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const
const COUNTS_AS_ACTIVE = ["DONE", "MINIMUM", "LOGGED", "CREATED"] as const

export interface PrepItem {
  habitId: string
  title: string
  prepare: string
  prepTime: string
}

export interface NowDto extends NowResult {
  moved: number // overdue to-dos quietly moved to this week (after a long break)
  prep: PrepItem[]
}

interface Clock {
  tz: string
  now: Date
  todayKey: string
  nowMin: number
  weekday: number
  dayOfMonth: number
}

const getClock = async (userId: string, at?: string): Promise<Clock> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } })
  const tz = user?.timezone ?? "Asia/Kolkata"
  // `at` ("2026-10-07T21:35", local) lets evals and support check another
  // time of day. It is ignored in production so nobody can time-travel real data.
  const override = at && env.NODE_ENV !== "production" ? localToUtc(at, tz) : null
  const now = override ?? new Date()
  const todayKey = dayKeyInTz(now, tz)
  const nowMin = Math.round((now.getTime() - localDayStartMs(todayKey, tz)) / 60_000)
  const d = dateFromKey(todayKey)
  return { tz, now, todayKey, nowMin, weekday: d.getUTCDay(), dayOfMonth: d.getUTCDate() }
}

const getMode = async (userId: string, now: Date): Promise<{ mode: Mode; until: Date | null }> => {
  const s = await prisma.userSettings.findUnique({ where: { userId }, select: { mode: true, modeUntil: true } })
  const mode = MODES.includes(s?.mode as Mode) ? (s!.mode as Mode) : "NORMAL"
  // A mode with an end date quietly ends itself.
  if (mode !== "NORMAL" && s?.modeUntil && s.modeUntil.getTime() < now.getTime()) return { mode: "NORMAL", until: null }
  return { mode, until: s?.modeUntil ?? null }
}

const getDay = async (userId: string, weekday: number): Promise<DayBlock[]> => {
  const row = await prisma.daySchedule.findUnique({ where: { userId_weekday: { userId, weekday } } })
  return normalizeDay(row?.blocks) ?? defaultDay(weekday)
}

const habitScheduledOn = (h: { frequency: string; specificDays: string[] }, weekday: number) =>
  h.frequency !== "CUSTOM" || h.specificDays.includes(WEEKDAY_CODES[weekday]!)

const parseSizes = (v: unknown): HabitSize[] =>
  Array.isArray(v)
    ? v
        .map((s) => ({ minutes: Number((s as HabitSize)?.minutes), label: String((s as HabitSize)?.label ?? "") }))
        .filter((s) => Number.isFinite(s.minutes) && s.minutes > 0)
    : []

const asBlock = (v: string | null): Block | null =>
  v && ["MORNING", "COMMUTE", "OFFICE", "GYM", "EVENING", "NIGHT"].includes(v) ? (v as Block) : null

const lastActiveGapDays = async (userId: string, c: Clock): Promise<number> => {
  const last = await prisma.activityEvent.findFirst({
    where: { userId, type: { in: [...COUNTS_AS_ACTIVE] }, source: { not: "SYSTEM" }, at: { lte: c.now } },
    orderBy: { at: "desc" },
    select: { at: true },
  })
  return last ? Math.max(0, daysBetweenKeys(dayKeyInTz(last.at, c.tz), c.todayKey)) : 0
}

const loadCandidates = async (userId: string, c: Clock): Promise<NowCandidate[]> => {
  const [areas, tasks, habits] = await Promise.all([
    prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true, tier: true, laterUntil: true } }),
    prisma.task.findMany({
      where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null, remindAt: null },
      include: { project: { select: { kind: true, status: true } }, goal: { select: { title: true, why: true, status: true, areaId: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true },
      include: { logs: { where: { date: dateFromKey(c.todayKey), completed: true }, select: { id: true } } },
    }),
  ])
  const area = new Map(areas.map((a) => [a.id, { name: a.name, tier: effectiveTier(a.tier as Tier, a.laterUntil, c.now) }]))

  const fromTasks: NowCandidate[] = tasks
    .filter((t) => t.project?.status !== "ABANDONED" && t.project?.status !== "PAUSED")
    .map((t, i) => {
      const areaId = t.areaId ?? t.goal?.areaId ?? null
      const a = areaId ? area.get(areaId) : undefined
      return {
        sourceType: "TASK" as const,
        sourceId: t.id,
        title: t.title,
        // A to-do inside a work project is office work unless said otherwise.
        block: asBlock(t.block) ?? (t.project?.kind === "WORK" ? "OFFICE" : null),
        sizeMinutes: t.sizeMinutes ?? t.targetMinutes,
        minimum: t.minimumVersion,
        tier: t.goal && t.goal.status !== "ACTIVE" ? "LATER" : (a?.tier ?? "MAINTAIN"),
        priority: t.priority,
        dueKey: t.dueDate ? utcDayKey(t.dueDate) : null,
        order: i,
        areaName: a?.name ?? null,
        goalTitle: t.goal?.title ?? null,
        goalWhy: t.goal?.why ?? null,
      }
    })

  const fromHabits: NowCandidate[] = habits
    .filter((h) => h.logs.length === 0 && habitScheduledOn(h, c.weekday))
    .map((h, i) => ({
      sourceType: "HABIT" as const,
      sourceId: h.id,
      title: h.title,
      block: asBlock(h.timeBlock),
      sizeMinutes: h.targetMinutes,
      sizes: parseSizes(h.sizes),
      anchor: h.anchor,
      minimum: h.minimumVersion,
      tier: area.get(h.areaId)?.tier ?? "MAINTAIN",
      dueKey: null,
      order: 1000 + i,
      areaName: area.get(h.areaId)?.name ?? null,
      goalTitle: null,
      goalWhy: null,
    }))

  return [...fromTasks, ...fromHabits]
}

// Prep steps ("soak the oats") surface from the prep time on, the evening
// before a day the habit is scheduled, once.
const prepDue = async (userId: string, c: Clock): Promise<PrepItem[]> => {
  const habits = await prisma.habit.findMany({
    where: { userId, isActive: true, prepareAhead: { not: null }, prepTime: { not: null } },
    select: { id: true, title: true, prepareAhead: true, prepTime: true, frequency: true, specificDays: true },
  })
  const due = habits.filter((h) => {
    const [hh, mm] = h.prepTime!.split(":").map(Number)
    const from = (hh ?? 0) * 60 + (mm ?? 0)
    return c.nowMin >= from && habitScheduledOn(h, (c.weekday + 1) % 7)
  })
  if (!due.length) return []
  const dayStart = new Date(localDayStartMs(c.todayKey, c.tz))
  const done = await prisma.activityEvent.findMany({
    where: { userId, reason: "PREP", itemType: "HABIT", itemId: { in: due.map((h) => h.id) }, at: { gte: dayStart } },
    select: { itemId: true },
  })
  const doneIds = new Set(done.map((d) => d.itemId))
  return due
    .filter((h) => !doneIds.has(h.id))
    .map((h) => ({ habitId: h.id, title: h.title, prepare: h.prepareAhead!, prepTime: h.prepTime! }))
}

export const markPrepDoneService = async (userId: string, habitId: string, source: ActivitySource = "APP") => {
  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId }, select: { id: true, prepareAhead: true } })
  if (!habit) return null
  return recordActivity(userId, { type: "DONE", itemType: "HABIT", itemId: habit.id, title: habit.prepareAhead, reason: "PREP", source })
}

// After a long break, overdue to-dos are quietly moved to this week rather
// than shown as a pile of red (plan rule 8).
const moveOverdueToThisWeek = async (userId: string, c: Clock): Promise<number> => {
  const overdue = await prisma.task.findMany({
    where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null, remindAt: null, dueDate: { lt: dateFromKey(c.todayKey) } },
    select: { id: true, dueDate: true },
  })
  if (!overdue.length) return 0
  const sunday = new Date(dateFromKey(c.todayKey).getTime() + ((7 - c.weekday) % 7) * 86_400_000)
  await prisma.task.updateMany({ where: { userId, id: { in: overdue.map((t) => t.id) } }, data: { dueDate: sunday } })
  await recordActivity(userId, {
    type: "UPDATED",
    itemType: "TASK",
    title: `Moved ${overdue.length} overdue to this week`,
    source: "SYSTEM",
    undo: { kind: "RESTORE_DUE", items: overdue.map((t) => ({ taskId: t.id, prev: t.dueDate ? t.dueDate.toISOString() : null })) },
  })
  return overdue.length
}

export const getNowService = async (userId: string, opts: { minutes?: number | null; at?: string } = {}): Promise<NowDto> => {
  const c = await getClock(userId, opts.at)
  const [{ mode }, blocks, gapDays, candidates, prep] = await Promise.all([
    getMode(userId, c.now),
    getDay(userId, c.weekday),
    lastActiveGapDays(userId, c),
    loadCandidates(userId, c),
    prepDue(userId, c),
  ])
  const moved = gapDays >= 14 ? await moveOverdueToThisWeek(userId, c) : 0
  const minutes = opts.minutes && opts.minutes > 0 ? Math.min(opts.minutes, 600) : null
  const result = rightNow({
    nowMin: c.nowMin,
    todayKey: c.todayKey,
    weekday: c.weekday,
    dayOfMonth: c.dayOfMonth,
    blocks,
    mode,
    minutes,
    gapDays,
    // After a move the old overdue dates are gone, so rebuild what was loaded.
    candidates: moved ? await loadCandidates(userId, c) : candidates,
  })
  if (moved) result.message = result.message.replace("Welcome back. Nothing is lost.", `Welcome back. Nothing is lost, and I moved ${moved} old item${moved === 1 ? "" : "s"} to this week.`)
  return { ...result, moved, prep: mode === "SICK" ? [] : prep }
}

// ---- mode ------------------------------------------------------------

export const setModeService = async (
  userId: string,
  mode: Mode,
  untilKey: string | null,
  source: ActivitySource = "APP",
): Promise<{ mode: Mode; until: Date | null; activityId?: string }> => {
  if (!MODES.includes(mode)) throw new Error("Unknown mode")
  const prev = await prisma.userSettings.findUnique({ where: { userId }, select: { mode: true, modeUntil: true } })
  const until = mode === "NORMAL" || !untilKey ? null : dateFromKey(untilKey)
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, enabledModules: [], mode, modeUntil: until },
    update: { mode, modeUntil: until },
  })
  const event = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "SETTING",
    title: mode === "NORMAL" ? "Back to normal mode" : `${mode.toLowerCase()} mode on`,
    source,
    undo: { kind: "RESTORE_MODE", prev: prev?.mode ?? "NORMAL", prevUntil: prev?.modeUntil ? prev.modeUntil.toISOString() : null },
  })
  return { mode, until, activityId: event?.id }
}

export const getModeService = async (userId: string) => {
  const c = await getClock(userId)
  return getMode(userId, c.now)
}

// ---- schedule --------------------------------------------------------

export const getScheduleService = async (userId: string) => {
  const rows = await prisma.daySchedule.findMany({ where: { userId } })
  const byDay = new Map(rows.map((r) => [r.weekday, normalizeDay(r.blocks)]))
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    custom: !!byDay.get(weekday),
    blocks: byDay.get(weekday) ?? defaultDay(weekday),
  }))
}

// Sets the same day shape on several weekdays ("weekdays: office 10 to 8:30").
export const setScheduleService = async (
  userId: string,
  weekdays: number[],
  rawBlocks: unknown,
  source: ActivitySource = "APP",
): Promise<{ blocks: DayBlock[]; weekdays: number[]; activityId?: string } | null> => {
  const blocks = normalizeDay(rawBlocks)
  const days = [...new Set(weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
  if (!blocks || !days.length) return null
  const prev = await prisma.daySchedule.findMany({ where: { userId, weekday: { in: days } } })
  for (const weekday of days) {
    await prisma.daySchedule.upsert({
      where: { userId_weekday: { userId, weekday } },
      create: { userId, weekday, blocks: blocks as unknown as Prisma.InputJsonValue },
      update: { blocks: blocks as unknown as Prisma.InputJsonValue },
    })
  }
  const event = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "DAY",
    title: "Day schedule updated",
    source,
    undo: {
      kind: "RESTORE_SCHEDULE",
      weekdays: days,
      prev: prev.map((p) => ({ weekday: p.weekday, blocks: p.blocks })),
    },
  })
  return { blocks, weekdays: days, activityId: event?.id }
}

// ---- capacity guard + moving to-dos ---------------------------------

export interface CapacityDto extends CapacityResult {
  titles: Record<string, string>
}

// What is planned for today against the free time left today.
export const capacityTodayService = async (userId: string, at?: string): Promise<CapacityDto> => {
  const c = await getClock(userId, at)
  const [blocks, tasks] = await Promise.all([
    getDay(userId, c.weekday),
    prisma.task.findMany({
      where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null, remindAt: null, dueDate: dateFromKey(c.todayKey) },
      select: { id: true, title: true, sizeMinutes: true, priority: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ])
  const ordered = [...tasks].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
  const guard = capacityGuard(
    ordered.map((t, rank) => ({ id: t.id, title: t.title, minutes: t.sizeMinutes ?? DEFAULT_SIZE, rank })),
    remainingFreeToday(blocks, c.nowMin),
  )
  return { ...guard, titles: Object.fromEntries(tasks.map((t) => [t.id, t.title])) }
}

// "Move to later": the to-dos lose today's date but stay on the list.
export const moveTasksToLaterService = async (userId: string, taskIds: string[], source: ActivitySource = "APP") => {
  const rows = await prisma.task.findMany({
    where: { userId, id: { in: taskIds }, status: { in: ["TODO", "IN_PROGRESS"] } },
    select: { id: true, dueDate: true },
  })
  if (!rows.length) return { moved: 0 as number, activityId: undefined as string | undefined }
  await prisma.task.updateMany({ where: { userId, id: { in: rows.map((r) => r.id) } }, data: { dueDate: null } })
  const undo: UndoPayload = { kind: "RESTORE_DUE", items: rows.map((r) => ({ taskId: r.id, prev: r.dueDate ? r.dueDate.toISOString() : null })) }
  const event = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "TASK",
    title: `Moved ${rows.length} to later`,
    source,
    undo,
  })
  return { moved: rows.length, activityId: event?.id }
}
