/* =====================================================================
   Plan, Now responses and the stale to-do question (build step 7).
   Everything the screens show is computed here, so the phone only draws it
   and can cache the last answer for offline use.
   ===================================================================== */
import type { ActivitySource } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { completeTaskService } from "../task/task.service.js"
import { logHabitService } from "../habit/habit.service.js"
import { getClock } from "./now.service.js"
import { listStandsService, type StandDto } from "../progress/progress.service.js"
import { habitLife } from "../progress/progress.rules.js"
import { dateFromKey, dayKeyInTz, localDayStartMs, utcDayKey } from "../../shared/utils/time.util.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { BLOCKS, type Block } from "./now.rules.js"
import { bucketFor, groupByBlock, groupByDay, type BlockGroup, type DayGroup, type PlanItem } from "./plan.rules.js"

const DAY = 86_400_000
const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const

const asBlock = (v: string | null): Block | null => (v && (BLOCKS as readonly string[]).includes(v) ? (v as Block) : null)

export interface PlanHabit {
  id: string
  title: string
  stage: string
  consistency: number // completed days in the last 28
  todayDone: boolean
  timeBlock: string | null
  anchor: string | null
  scheduledToday: boolean
}

export interface PlanDto {
  date: string
  today: { blocks: BlockGroup[]; done: number; total: number }
  thisWeek: { days: DayGroup[]; carried: PlanItem[] }
  later: { count: number }
  projects: { office: StandDto[]; personal: StandDto[] }
  habits: PlanHabit[]
}

export const getPlanService = async (userId: string, at?: string): Promise<PlanDto> => {
  const c = await getClock(userId, at)
  const dayStart = new Date(localDayStartMs(c.todayKey, c.tz))
  const dayEnd = new Date(dayStart.getTime() + DAY)
  const since = dateFromKey(new Date(Date.parse(`${c.todayKey}T00:00:00Z`) - 70 * DAY).toISOString().slice(0, 10))

  const [tasks, habits, stands] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        archivedAt: null,
        OR: [{ status: { in: ["TODO", "IN_PROGRESS"] } }, { status: "COMPLETED", completedAt: { gte: dayStart, lt: dayEnd } }],
      },
      include: { project: { select: { title: true, kind: true, status: true } } },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true },
      include: { logs: { where: { completed: true, date: { gte: since } }, select: { date: true } } },
    }),
    listStandsService(userId, { all: true }),
  ])

  const todayItems: PlanItem[] = []
  const weekItems: PlanItem[] = []
  const carried: PlanItem[] = []
  let later = 0

  for (const t of tasks) {
    if (t.project?.status === "ABANDONED" || t.project?.status === "PAUSED") continue
    const isReminder = t.remindAt !== null
    const dueKey = t.remindAt ? dayKeyInTz(t.remindAt, c.tz) : t.dueDate ? utcDayKey(t.dueDate) : null
    const done = t.status === "COMPLETED"
    const item: PlanItem = {
      id: t.id,
      type: isReminder ? "REMINDER" : "TASK",
      title: t.title,
      block: isReminder ? "ANYTIME" : (asBlock(t.block) ?? (t.project?.kind === "WORK" ? "OFFICE" : "ANYTIME")),
      minutes: t.sizeMinutes,
      done,
      at: t.remindAt ? t.remindAt.toISOString() : null,
      dueKey,
      minimum: t.minimumVersion,
      projectTitle: t.project?.title ?? null,
      priorityRank: PRIORITY_RANK[t.priority],
    }
    if (done) {
      todayItems.push(item) // finished today: stays visible, progress only accumulates
      continue
    }
    const bucket = bucketFor(dueKey, c.todayKey)
    if (bucket === "TODAY") todayItems.push(item)
    else if (bucket === "WEEK") weekItems.push(item)
    else if (bucket === "CARRIED") carried.push({ ...item, dueKey: c.todayKey })
    else if (!isReminder) later++
  }

  const planHabits: PlanHabit[] = []
  for (const h of habits) {
    const keys = new Set(h.logs.map((l) => utcDayKey(l.date)))
    const life = habitLife({
      createdAt: h.createdAt, frequency: h.frequency, weeklyTarget: h.weeklyTarget, specificDays: h.specificDays,
      completedDayKeys: keys, todayKey: c.todayKey, stage: h.stage,
    })
    const todayDone = keys.has(c.todayKey)
    const scheduledToday =
      h.frequency === "CUSTOM"
        ? h.specificDays.includes(WEEKDAY_CODES[c.weekday]!)
        : h.frequency === "WEEKLY"
          ? [...keys].filter((k) => k > new Date(Date.parse(`${c.todayKey}T00:00:00Z`) - 6 * DAY).toISOString().slice(0, 10)).length < (h.weeklyTarget ?? 1) || todayDone
          : true
    planHabits.push({
      id: h.id, title: h.title, stage: h.stage, consistency: life.consistency28, todayDone,
      timeBlock: h.timeBlock, anchor: h.anchor, scheduledToday,
    })
    // An automatic habit is part of you now: it is not placed on today's list.
    if (scheduledToday && h.stage !== "AUTOMATIC") {
      todayItems.push({
        id: h.id, type: "HABIT", title: h.title, block: asBlock(h.timeBlock) ?? "ANYTIME", minutes: h.targetMinutes,
        done: todayDone, at: null, dueKey: c.todayKey, stage: h.stage, minimum: h.minimumVersion,
      })
    }
  }

  const total = todayItems.length
  return {
    date: c.todayKey,
    today: { blocks: groupByBlock(todayItems), done: todayItems.filter((i) => i.done).length, total },
    thisWeek: { days: groupByDay(weekItems), carried },
    later: { count: later },
    projects: {
      office: stands.filter((s) => s.kind === "WORK"),
      personal: stands.filter((s) => s.kind !== "WORK"),
    },
    habits: planHabits,
  }
}

// ---- Done / Smaller / Not now ---------------------------------------------------

export interface RespondInput {
  sourceType: "TASK" | "HABIT"
  sourceId: string
  action: "DONE" | "MINIMUM" | "SKIP"
  reason?: string
}

export const respondNowService = async (userId: string, input: RespondInput, source: ActivitySource = "APP") => {
  const { sourceType, sourceId, action } = input
  if (sourceType === "TASK") {
    const t = await prisma.task.findFirst({ where: { id: sourceId, userId }, select: { id: true, title: true } })
    if (!t) throw new NotFoundError("To-do not found")
    if (action === "DONE") {
      const done = await completeTaskService(sourceId, userId, { source })
      return { action, activityId: done.activityId }
    }
    const ev = await recordActivity(userId, {
      type: action === "MINIMUM" ? "MINIMUM" : "SKIPPED",
      itemType: "TASK",
      itemId: sourceId,
      title: t.title,
      reason: action === "SKIP" ? (input.reason?.trim() || "not now") : null,
      source,
      undo: { kind: "NOOP" },
    })
    return { action, activityId: ev?.id }
  }
  const h = await prisma.habit.findFirst({ where: { id: sourceId, userId }, select: { id: true, title: true } })
  if (!h) throw new NotFoundError("Habit not found")
  if (action === "SKIP") {
    const ev = await recordActivity(userId, {
      type: "SKIPPED", itemType: "HABIT", itemId: sourceId, title: h.title, reason: input.reason?.trim() || "not now", source, undo: { kind: "NOOP" },
    })
    return { action, activityId: ev?.id }
  }
  const log = await logHabitService(sourceId, userId, { completed: true }, { source, type: action === "MINIMUM" ? "MINIMUM" : "LOGGED" })
  return { action, activityId: log.activityId }
}

// ---- "Still want these 5?": one batch question about old, untouched to-dos ------------

const STALE_DAYS = 30

export interface StaleDto {
  total: number
  items: { id: string; title: string; ageDays: number }[]
}

export const getStaleService = async (userId: string, at?: string): Promise<StaleDto> => {
  const c = await getClock(userId, at)
  const cutoff = new Date(c.now.getTime() - STALE_DAYS * DAY)
  const old = await prisma.task.findMany({
    where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null, remindAt: null, createdAt: { lte: cutoff } },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  })
  if (!old.length) return { total: 0, items: [] }
  // Anything touched (done, skipped, kept, snoozed…) in the last 30 days is not stale.
  const touched = await prisma.activityEvent.findMany({
    where: { userId, itemType: "TASK", itemId: { in: old.map((t) => t.id) }, at: { gte: cutoff }, undoneAt: null },
    select: { itemId: true },
  })
  const skip = new Set(touched.map((e) => e.itemId))
  const stale = old.filter((t) => !skip.has(t.id))
  return {
    total: stale.length,
    items: stale.slice(0, 5).map((t) => ({ id: t.id, title: t.title, ageDays: Math.floor((c.now.getTime() - t.createdAt.getTime()) / DAY) })),
  }
}

export const resolveStaleService = async (userId: string, input: { keepIds: string[]; letGoIds: string[] }, source: ActivitySource = "APP") => {
  if (!input.keepIds.length && !input.letGoIds.length) throw new ValidationError("Nothing chosen")
  const ids = [...input.keepIds, ...input.letGoIds]
  const rows = await prisma.task.findMany({ where: { userId, id: { in: ids } }, select: { id: true, title: true, status: true } })
  const owned = new Map(rows.map((r) => [r.id, r]))
  // Keeping is an answer too: it quiets the question for another 30 days.
  for (const id of input.keepIds) {
    const t = owned.get(id)
    if (t) await recordActivity(userId, { type: "SNOOZED", itemType: "TASK", itemId: id, title: t.title, source, undo: { kind: "NOOP" } })
  }
  const letGo = input.letGoIds.map((id) => owned.get(id)).filter((t): t is NonNullable<typeof t> => !!t)
  let activityId: string | undefined
  if (letGo.length) {
    await prisma.task.updateMany({ where: { userId, id: { in: letGo.map((t) => t.id) } }, data: { archivedAt: new Date(), status: "CANCELLED" } })
    const ev = await recordActivity(userId, {
      type: "ARCHIVED", itemType: "TASK", title: `Let go of ${letGo.length} old to-do${letGo.length === 1 ? "" : "s"}`, source,
      undo: { kind: "RESTORE_ARCHIVED", items: letGo.map((t) => ({ taskId: t.id, prevStatus: t.status })) },
    })
    activityId = ev?.id
  }
  return { kept: input.keepIds.filter((id) => owned.has(id)).length, letGo: letGo.length, activityId }
}
