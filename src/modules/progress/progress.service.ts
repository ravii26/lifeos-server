/* =====================================================================
   Progress service: loads milestones, metric entries, the activity log and
   habit logs, hands them to the pure rules (progress.rules.ts), and applies
   the few writes (log progress, change a project's status, habit stage).
   Everything shown is derived; nothing is stored as "progress".
   ===================================================================== */
import type { ActivitySource } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { getClock, type Clock } from "../now/now.service.js"
import { dateFromKey, dayKeyInTz, utcDayKey } from "../../shared/utils/time.util.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import {
  habitLife,
  metricStand,
  milestoneStand,
  practiceStand,
  workStand,
  type MilestoneIn,
  type Stage,
} from "./progress.rules.js"

const DAY = 86_400_000

export type ProjectKind = "OUTCOME" | "MILESTONE" | "PRACTICE" | "WORK"

export interface StandDto {
  id: string
  title: string
  kind: ProjectKind
  status: string
  why: string | null
  message: string // the one line shown to the person
  detail: Record<string, unknown> // structured numbers for the app and tests
  options: string[] // choices offered when progress stalls (no guilt)
}

// Monday of the week containing `key`.
const mondayKey = (key: string): string => {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
const addKeyDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

// ---- one project's stand ----------------------------------------------

type ProjectRow = NonNullable<Awaited<ReturnType<typeof findProject>>>

const findProject = (userId: string, id: string) =>
  prisma.project.findFirst({ where: { id, userId }, include: { milestones: true, metric: { include: { entries: true } } } })

const standOf = async (userId: string, p: ProjectRow, c: Clock): Promise<StandDto> => {
  const base = { id: p.id, title: p.title, kind: p.kind as ProjectKind, status: p.status, why: p.why, options: [] as string[] }

  if (p.kind === "MILESTONE") {
    const events = await prisma.activityEvent.findMany({
      where: { userId, type: "LOGGED", itemType: "MILESTONE", itemId: { in: p.milestones.map((m) => m.id) }, undoneAt: null },
      select: { itemId: true, value: true },
    })
    const units = new Map<string, number>()
    for (const e of events) units.set(e.itemId!, (units.get(e.itemId!) ?? 0) + (e.value ?? 0))
    const ms: MilestoneIn[] = p.milestones.map((m) => ({ title: m.title, order: m.order, target: m.target, doneAt: m.doneAt, progress: units.get(m.id) ?? 0 }))
    const s = milestoneStand(ms, { now: c.now, createdAt: p.createdAt, deadline: p.deadline })
    return { ...base, message: s.message, detail: { stage: s.stage, total: s.total, percent: s.percent, pace: s.pace, forecast: s.forecast?.toISOString() ?? null, next: s.current } }
  }

  if (p.kind === "OUTCOME" && p.metric) {
    const s = metricStand(p.metric, p.metric.entries, c.now)
    return { ...base, options: s.options, message: s.message, detail: { start: s.start, latest: s.latest, target: s.target, percent: s.percent, weeklyChange: s.weeklyChange, trend: s.trend, forecast: s.forecast?.toISOString() ?? null } }
  }

  if (p.kind === "PRACTICE") {
    const target = p.weeklyTargetMinutes ?? 0
    const thisMonday = mondayKey(c.todayKey)
    const firstMonday = addKeyDays(thisMonday, -7 * 8)
    const events = await prisma.activityEvent.findMany({
      where: { userId, type: "LOGGED", itemType: "PROJECT", itemId: p.id, undoneAt: null },
      select: { minutes: true, at: true },
    })
    const weeks = new Map<string, number>()
    let total = 0
    for (const e of events) {
      total += e.minutes ?? 0
      const k = mondayKey(dayKeyInTz(e.at, c.tz))
      if (k >= firstMonday) weeks.set(k, (weeks.get(k) ?? 0) + (e.minutes ?? 0))
    }
    const series = Array.from({ length: 9 }, (_, i) => weeks.get(addKeyDays(firstMonday, i * 7)) ?? 0)
    // Weeks before you started do not count against you.
    const firstActive = series.findIndex((m) => m > 0)
    const s = practiceStand(target, firstActive < 0 ? series.slice(-1) : series.slice(firstActive), total)
    return { ...base, message: target ? s.message : `${s.message} · set a weekly target to track it`, detail: { ...s } }
  }

  // WORK (and an outcome project without a metric yet): to-dos against the deadline.
  const tasks = await prisma.task.findMany({
    where: { userId, projectId: p.id, archivedAt: null, status: { not: "CANCELLED" } },
    select: { status: true, completedAt: true },
  })
  const done = tasks.filter((t) => t.status === "COMPLETED").length
  const recent = tasks.filter((t) => t.completedAt && c.now.getTime() - t.completedAt.getTime() <= 14 * DAY).length
  const s = workStand(done, tasks.length, p.deadline ? utcDayKey(p.deadline) : null, c.todayKey, recent / 2)
  return { ...base, message: s.message, detail: { ...s } }
}

export const getStandService = async (userId: string, projectId: string): Promise<StandDto> => {
  const p = await findProject(userId, projectId)
  if (!p) throw new NotFoundError("Project not found")
  return standOf(userId, p, await getClock(userId))
}

export const listStandsService = async (userId: string, opts: { all?: boolean } = {}): Promise<StandDto[]> => {
  const c = await getClock(userId)
  const rows = await prisma.project.findMany({
    where: { userId, status: opts.all ? { in: ["ACTIVE", "PAUSED"] } : "ACTIVE" },
    include: { milestones: true, metric: { include: { entries: true } } },
    orderBy: { createdAt: "asc" },
    take: 30,
  })
  return Promise.all(rows.map((p) => standOf(userId, p, c)))
}

// ---- logging progress ----------------------------------------------------

export interface LogInput {
  projectId: string
  count?: number // units toward the current milestone ("23 DSA problems")
  minutes?: number // practice time
  value?: number // a metric reading (weight)
  milestoneDone?: boolean // finish the current milestone that has no counter
  at?: Date
}

export interface LogResult {
  stand: StandDto
  activityId?: string
  what: string
}

export const logProgressService = async (userId: string, input: LogInput, source: ActivitySource = "APP"): Promise<LogResult> => {
  const p = await findProject(userId, input.projectId)
  if (!p) throw new NotFoundError("Project not found")
  const c = await getClock(userId)
  const at = input.at && input.at.getTime() <= Date.now() ? input.at : new Date()
  let eventId: string | undefined
  let what = ""

  if (p.kind === "OUTCOME" && p.metric && input.value !== undefined) {
    const entry = await prisma.metricEntry.create({ data: { metricId: p.metric.id, value: input.value, at } })
    const ev = await recordActivity(userId, {
      type: "LOGGED", itemType: "METRIC", itemId: p.metric.id, title: `${p.metric.name} ${input.value}${p.metric.unit ? ` ${p.metric.unit}` : ""}`,
      value: input.value, source, undo: { kind: "DELETE_METRIC_ENTRY", entryId: entry.id },
    })
    eventId = ev?.id
    what = `${p.metric.name} ${input.value}${p.metric.unit ? ` ${p.metric.unit}` : ""}`
  } else if (p.kind === "MILESTONE") {
    const ordered = [...p.milestones].sort((a, b) => a.order - b.order)
    const doneIds = new Set(ordered.filter((m) => m.doneAt).map((m) => m.id))
    const sums = await prisma.activityEvent.groupBy({
      by: ["itemId"], where: { userId, type: "LOGGED", itemType: "MILESTONE", itemId: { in: ordered.map((m) => m.id) }, undoneAt: null }, _sum: { value: true },
    })
    const logged = new Map(sums.map((s) => [s.itemId!, s._sum.value ?? 0]))
    const cur = ordered.find((m) => !doneIds.has(m.id) && !(m.target && (logged.get(m.id) ?? 0) >= m.target))
    if (!cur) throw new ValidationError("Every stage of this project is already done.")
    if (input.milestoneDone) {
      await prisma.milestone.update({ where: { id: cur.id }, data: { doneAt: at } })
      const ev = await recordActivity(userId, {
        type: "DONE", itemType: "MILESTONE", itemId: cur.id, title: cur.title, source, undo: { kind: "RESTORE_MILESTONE", milestoneId: cur.id },
      })
      eventId = ev?.id
      what = `${cur.title} done`
    } else if (input.count !== undefined && input.count > 0) {
      const ev = await recordActivity(userId, {
        type: "LOGGED", itemType: "MILESTONE", itemId: cur.id, title: cur.title, value: input.count, source, undo: { kind: "NOOP" },
      })
      eventId = ev?.id
      what = `${input.count} toward ${cur.title}`
    } else throw new ValidationError("Say how many, or that the stage is done.")
  } else if (p.kind === "PRACTICE" && input.minutes !== undefined && input.minutes > 0) {
    const ev = await recordActivity(userId, {
      type: "LOGGED", itemType: "PROJECT", itemId: p.id, title: p.title, minutes: Math.round(input.minutes), source, undo: { kind: "NOOP" },
    })
    eventId = ev?.id
    what = `${Math.round(input.minutes)} min of ${p.title}`
    if (ev && input.at) await prisma.activityEvent.update({ where: { id: ev.id }, data: { at } })
  } else {
    throw new ValidationError(
      p.kind === "WORK" ? "This project moves when its to-dos are done." : "That doesn't fit this kind of project (use a number, minutes, or a reading).",
    )
  }
  // A backdated reading or count counts on the day it happened.
  if (eventId && input.at && p.kind !== "PRACTICE") await prisma.activityEvent.update({ where: { id: eventId }, data: { at } })
  const fresh = (await findProject(userId, p.id))!
  return { stand: await standOf(userId, fresh, c), activityId: eventId, what }
}

// ---- pausing and letting go (no guilt, plan F26) --------------------------

export type ProjectStatusChange = "PAUSED" | "ABANDONED" | "ACTIVE" | "COMPLETED"

export const STATUS_LINE: Record<ProjectStatusChange, string> = {
  PAUSED: 'Paused. It waits for you and nothing is lost. Say "resume" when you want it back.',
  ABANDONED: "Let go. Choosing what not to carry is a real decision, and what you already did stays in your history.",
  ACTIVE: "Back on. Picking up from where you left it.",
  COMPLETED: "Done. That counts, and it stays in your history.",
}

export const setProjectStatusService = async (
  userId: string,
  projectId: string,
  status: ProjectStatusChange,
  source: ActivitySource = "APP",
): Promise<{ title: string; status: ProjectStatusChange; line: string; activityId?: string }> => {
  const p = await prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true, title: true, status: true } })
  if (!p) throw new NotFoundError("Project not found")
  await prisma.project.update({ where: { id: p.id }, data: { status } })
  const ev = await recordActivity(userId, {
    type: status === "COMPLETED" ? "DONE" : "UPDATED",
    itemType: "PROJECT",
    itemId: p.id,
    title: `${p.title}: ${status.toLowerCase()}`,
    source,
    undo: { kind: "RESTORE_PROJECT_STATUS", projectId: p.id, prev: p.status },
  })
  return { title: p.title, status, line: STATUS_LINE[status], activityId: ev?.id }
}

// ---- habit lifecycle -------------------------------------------------------

export interface HabitStageDto {
  id: string
  title: string
  stage: Stage
  consistency: string
  changed: boolean
}

export const refreshHabitStagesService = async (userId: string, c?: Clock): Promise<HabitStageDto[]> => {
  const clock = c ?? (await getClock(userId))
  const since = dateFromKey(addKeyDays(clock.todayKey, -70))
  const habits = await prisma.habit.findMany({
    where: { userId, isActive: true },
    include: { logs: { where: { completed: true, date: { gte: since } }, select: { date: true } } },
  })
  const out: HabitStageDto[] = []
  for (const h of habits) {
    const life = habitLife({
      createdAt: h.createdAt,
      frequency: h.frequency,
      weeklyTarget: h.weeklyTarget,
      specificDays: h.specificDays,
      completedDayKeys: new Set(h.logs.map((l) => utcDayKey(l.date))),
      todayKey: clock.todayKey,
      stage: h.stage,
    })
    const changed = life.stage !== h.stage
    if (changed) {
      await prisma.habit.update({ where: { id: h.id }, data: { stage: life.stage } })
      await recordActivity(userId, {
        type: "UPDATED", itemType: "HABIT", itemId: h.id,
        title: life.stage === "AUTOMATIC" ? `${h.title} is automatic now` : `${h.title} is back to building`,
        source: "SYSTEM",
      })
    }
    out.push({ id: h.id, title: h.title, stage: life.stage, consistency: life.message, changed })
  }
  return out
}

// Once a day per person is enough; this keeps GET /now cheap.
const refreshedOn = new Map<string, string>()
export const maybeRefreshHabitStages = async (userId: string, c: Clock): Promise<void> => {
  if (refreshedOn.get(userId) === c.todayKey) return
  refreshedOn.set(userId, c.todayKey)
  await refreshHabitStagesService(userId, c).catch(() => refreshedOn.delete(userId))
}

// ---- the weekly card, on request only (never scheduled) ----------------------

export interface WeekCardDto {
  message: string
  kept: number
  done: number
  minimums: number
  habits: { title: string; days: number }[]
  moved: { title: string; message: string }[]
  topArea: string | null
}

export const weekCardService = async (userId: string, at?: string): Promise<WeekCardDto> => {
  const c = await getClock(userId, at)
  const since = new Date(c.now.getTime() - 7 * DAY)
  const [events, habits, stands, tasks] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { userId, at: { gte: since, lte: c.now }, undoneAt: null, type: { in: ["DONE", "MINIMUM", "LOGGED"] } },
      select: { type: true, itemType: true, itemId: true },
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true },
      include: { logs: { where: { completed: true, date: { gte: dateFromKey(addKeyDays(c.todayKey, -6)) } }, select: { date: true } } },
    }),
    listStandsService(userId),
    prisma.task.findMany({
      where: { userId, status: "COMPLETED", completedAt: { gte: since } },
      select: { area: { select: { name: true } } },
    }),
  ])
  const done = events.filter((e) => e.type === "DONE" && (e.itemType === "TASK" || e.itemType === "HABIT")).length
  const minimums = events.filter((e) => e.type === "MINIMUM").length
  const kept = done + minimums
  const habitDays = habits
    .map((h) => ({ title: h.title, days: new Set(h.logs.map((l) => utcDayKey(l.date))).size }))
    .filter((h) => h.days > 0)
    .sort((a, b) => b.days - a.days)
    .slice(0, 3)
  const movedIds = new Set(events.filter((e) => e.itemType === "MILESTONE" || e.itemType === "METRIC" || e.itemType === "PROJECT").map((e) => e.itemId))
  const moved = stands.filter((s) => movedIds.has(s.id) || (s.detail as { done?: number }).done)
  const areaCounts = new Map<string, number>()
  for (const t of tasks) if (t.area?.name) areaCounts.set(t.area.name, (areaCounts.get(t.area.name) ?? 0) + 1)
  const topArea = [...areaCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const parts = [
    kept === 0
      ? "Nothing logged this week, and that's fine. A fresh week starts whenever you do."
      : `This week: ${kept} promise${kept === 1 ? "" : "s"} kept (${done} done, ${minimums} minimum).`,
  ]
  if (habitDays.length) parts.push(habitDays.map((h) => `${h.title} ${h.days} of 7 days`).join(", ") + ".")
  if (moved.length) parts.push(`Moved: ${moved.map((m) => `${m.title} (${(m.detail as { percent?: number }).percent ?? m.message.split(" · ")[0]}${typeof (m.detail as { percent?: number }).percent === "number" ? "%" : ""})`).join(", ")}.`)
  if (topArea) parts.push(`Most effort went to ${topArea}.`)
  return { message: parts.join(" "), kept, done, minimums, habits: habitDays, moved: moved.map((m) => ({ title: m.title, message: m.message })), topArea }
}
