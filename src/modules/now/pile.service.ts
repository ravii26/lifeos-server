/* =====================================================================
   Shrink the pile: everything on the list against the time there is, and
   the two decisions that change anything (park, let go). Keeping needs no
   call. Each decision is logged and undoable.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { NotFoundError } from "../../shared/utils/errors.util.js"
import { dateFromKey, daysBetweenKeys, dayKeyInTz, utcDayKey } from "../../shared/utils/time.util.js"
import { getClock, getDay, getMode } from "./now.service.js"
import { activeHolds } from "./hold.service.js"
import {
  ageLine,
  dueLine,
  habitWeeklyMinutes,
  holdReason,
  holdsEnded,
  monthName,
  needsLine,
  parkedRows,
  parkUntilKey,
  PILE_MAX,
  projectWeeklyMinutes,
  rankPile,
  returnedReason,
  taskMinutes,
  type PileItem,
  type PileType,
} from "./pile.rules.js"

const OPEN = ["TODO", "IN_PROGRESS"] as const
const iso = (d: Date | null) => (d ? d.toISOString() : null)

export const getPileService = async (userId: string) => {
  const c = await getClock(userId)
  const age = (d: Date) => Math.max(0, daysBetweenKeys(dayKeyInTz(d, c.tz), c.todayKey))
  const [tasks, habits, projects, holds, { mode }, days] = await Promise.all([
    // Reminders stay out: they cost a moment and were asked for one by one.
    prisma.task.findMany({
      where: { userId, status: { in: [...OPEN] }, archivedAt: null, remindAt: null, projectId: null },
      select: { id: true, title: true, sizeMinutes: true, targetMinutes: true, dueDate: true, createdAt: true },
      take: 300,
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true, isLimit: false, stage: { not: "AUTOMATIC" } },
      select: { id: true, title: true, frequency: true, weeklyTarget: true, specificDays: true, targetMinutes: true, createdAt: true },
    }),
    prisma.project.findMany({
      where: { userId, status: "ACTIVE" },
      select: {
        id: true,
        title: true,
        weeklyTargetMinutes: true,
        weeklyTargetCount: true,
        sessionMinutes: true,
        createdAt: true,
        tasks: { where: { status: { in: [...OPEN] }, archivedAt: null }, select: { sizeMinutes: true, targetMinutes: true } },
      },
    }),
    activeHolds(userId, c.todayKey),
    getMode(userId, c.now),
    Promise.all([0, 1, 2, 3, 4, 5, 6].map((d) => getDay(userId, d))),
  ])

  const make = (sourceType: PileType, sourceId: string, title: string, weeklyMinutes: number, createdAt: Date, dueKey: string | null): PileItem => ({
    sourceType,
    sourceId,
    title,
    weeklyMinutes,
    ageDays: age(createdAt),
    ageLine: ageLine(age(createdAt)),
    dueLine: dueLine(dueKey, c.todayKey),
    needs: needsLine(sourceType, weeklyMinutes),
  })

  const all = [
    ...projects.map((p) =>
      make("PROJECT", p.id, p.title, projectWeeklyMinutes({ ...p, openTaskMinutes: p.tasks.reduce((s, t) => s + taskMinutes(t), 0) }), p.createdAt, null),
    ),
    ...habits.map((h) => make("HABIT", h.id, h.title, habitWeeklyMinutes(h), h.createdAt, null)),
    ...tasks.map((t) => make("TASK", t.id, t.title, taskMinutes(t), t.createdAt, t.dueDate ? utcDayKey(t.dueDate) : null)),
  ].filter((i) => !holds.has(i.sourceId))

  const parkKey = parkUntilKey(c.todayKey)
  return {
    items: rankPile(all).slice(0, PILE_MAX),
    count: all.length,
    weeklyMinutes: all.reduce((s, i) => s + i.weeklyMinutes, 0),
    freeMinutes: days.flat().reduce((s, b) => s + b.freeMinutes, 0),
    parkUntil: parkKey,
    parkLabel: monthName(parkKey),
    // Letting go is a decision for a steady day, not a sick or overloaded one.
    canLetGo: mode !== "SICK" && mode !== "BUSY",
  }
}

export const decidePileService = async (
  userId: string,
  input: { sourceType: PileType; sourceId: string; decision: "PARK" | "LET_GO" },
): Promise<{ message: string; activityId?: string }> => {
  const c = await getClock(userId)
  const parkKey = parkUntilKey(c.todayKey)
  const label = monthName(parkKey)
  const park = input.decision === "PARK"
  const reason = park ? holdReason(parkKey) : undefined
  const type = park ? ("SNOOZED" as const) : ("ARCHIVED" as const)

  if (input.sourceType === "TASK") {
    const t = await prisma.task.findFirst({ where: { id: input.sourceId, userId }, select: { id: true, title: true, dueDate: true, status: true, archivedAt: true } })
    if (!t) throw new NotFoundError("To-do not found")
    await prisma.task.update({
      where: { id: t.id },
      data: park ? { dueDate: dateFromKey(parkKey) } : { status: "CANCELLED", archivedAt: new Date() },
    })
    const message = park ? `${t.title} is parked until ${label}.` : `Let go of ${t.title}.`
    const ev = await recordActivity(userId, {
      type, itemType: "TASK", itemId: t.id, title: message, reason,
      undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev: { dueDate: iso(t.dueDate), status: t.status, archivedAt: iso(t.archivedAt) } },
    })
    return { message, activityId: ev?.id }
  }

  if (input.sourceType === "HABIT") {
    const h = await prisma.habit.findFirst({ where: { id: input.sourceId, userId }, select: { id: true, title: true, isActive: true } })
    if (!h) throw new NotFoundError("Habit not found")
    await prisma.habit.update({ where: { id: h.id }, data: { isActive: false } })
    const message = park ? `${h.title} is parked until ${label}.` : `Let go of ${h.title}.`
    const ev = await recordActivity(userId, {
      type, itemType: "HABIT", itemId: h.id, title: message, reason,
      undo: { kind: "RESTORE_FIELDS", model: "habit", id: h.id, prev: { isActive: h.isActive } },
    })
    return { message, activityId: ev?.id }
  }

  const p = await prisma.project.findFirst({ where: { id: input.sourceId, userId }, select: { id: true, title: true, status: true } })
  if (!p) throw new NotFoundError("Project not found")
  await prisma.project.update({ where: { id: p.id }, data: { status: park ? "PAUSED" : "ABANDONED" } })
  const message = park ? `${p.title} is parked until ${label}.` : `Let go of ${p.title}.`
  const ev = await recordActivity(userId, {
    type, itemType: "PROJECT", itemId: p.id, title: message, reason,
    undo: { kind: "RESTORE_FIELDS", model: "project", id: p.id, prev: { status: p.status } },
  })
  return { message, activityId: ev?.id }
}

export const parkedListService = async (userId: string) => {
  const c = await getClock(userId)
  const events = await prisma.activityEvent.findMany({
    where: { userId, type: "SNOOZED", undoneAt: null, reason: { startsWith: "until:" } },
    orderBy: { at: "desc" },
    select: { id: true, itemId: true, itemType: true, title: true, reason: true },
    take: 300,
  })
  return parkedRows(events, c.todayKey)
}

// Parked goals and habits come back on their date. A to-do needs nothing: its hold just ends.
export const wakeParkedService = async (userId: string, todayKey: string): Promise<void> => {
  const events = await prisma.activityEvent.findMany({
    where: { userId, type: "SNOOZED", itemType: { in: ["HABIT", "PROJECT"] }, undoneAt: null, reason: { startsWith: "until:" } },
    orderBy: { at: "desc" },
    select: { id: true, itemId: true, itemType: true, reason: true },
  })
  for (const e of holdsEnded(events, todayKey)) {
    // Only what is still parked: something brought back by hand stays as it is.
    if (e.itemType === "HABIT") await prisma.habit.updateMany({ where: { id: e.itemId!, userId, isActive: false }, data: { isActive: true } })
    else await prisma.project.updateMany({ where: { id: e.itemId!, userId, status: "PAUSED" }, data: { status: "ACTIVE" } })
    await prisma.activityEvent.update({ where: { id: e.id }, data: { reason: returnedReason(e.reason!) } })
  }
}
