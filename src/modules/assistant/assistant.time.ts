/* =====================================================================
   Time tracking in chat (doc 18 item 6, ADR 0038): "start timer for DSA",
   "stop timer", "how long has it been?", "discard timer", "where did my
   time go today?". All code, no AI. One timer at a time; a timer left
   running over 4 hours is asked about, never guessed. A timed stretch on a
   goal with a weekly practice target counts toward that week through the
   same call as "30 min DSA"; anything else is just recorded time.
   ===================================================================== */
import type { TimeEntry } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { logProgressService } from "../progress/progress.service.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import { dateFromKey, dayKeyInTz } from "../../shared/utils/time.util.js"
import { matchCountHabit, periodRange } from "../log/log.rules.js"
import {
  duration,
  elapsedMinutes,
  forgottenReply,
  isForgotten,
  startedReply,
  stoppedReply,
  whereTimeWent,
  type TimeIntent,
} from "../log/time.rules.js"
import type { ChatResult } from "./assistant.chat.js"

const reply = (text: string, actions: ChatResult["actions"] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })

const running = (userId: string): Promise<TimeEntry | null> => prisma.timeEntry.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: "desc" } })

interface Link {
  itemType: "PROJECT" | "HABIT" | "TASK"
  itemId: string
  title: string
  practice: boolean // a goal with a weekly practice target: timed minutes count toward the week
}

// What the name points at: a goal first, then a habit, then an open to-do. Only a
// single clear match links; otherwise it is just a label.
const linkFor = async (userId: string, what: string): Promise<Link | null> => {
  const projects = await prisma.project.findMany({ where: { userId, status: "ACTIVE" }, select: { id: true, title: true, kind: true }, take: 100 })
  const p = matchCountHabit(what, projects)
  if (p) return { itemType: "PROJECT", itemId: p.id, title: p.title, practice: p.kind === "PRACTICE" }
  const habits = await prisma.habit.findMany({ where: { userId, isActive: true, isLimit: false }, select: { id: true, title: true }, take: 100 })
  const h = matchCountHabit(what, habits)
  if (h) return { itemType: "HABIT", itemId: h.id, title: h.title, practice: false }
  const tasks = await prisma.task.findMany({ where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null }, select: { id: true, title: true }, take: 200 })
  const t = matchCountHabit(what, tasks)
  if (t) return { itemType: "TASK", itemId: t.id, title: t.title, practice: false }
  return null
}

// Ends a running timer with these minutes. Returns what to tell the person.
const finish = async (userId: string, entry: TimeEntry, minutes: number): Promise<{ text: string; activityId?: string }> => {
  await prisma.timeEntry.update({ where: { id: entry.id }, data: { endedAt: new Date(), minutes } })
  let extra: string | null = null
  const undoParts: UndoPayload[] = [{ kind: "DELETE_TIME_ENTRY", entryId: entry.id }]
  if (entry.itemType === "PROJECT" && entry.itemId && minutes >= 1) {
    const p = await prisma.project.findFirst({ where: { id: entry.itemId, userId, kind: "PRACTICE", status: "ACTIVE" }, select: { id: true } })
    if (p) {
      const r = await logProgressService(userId, { projectId: p.id, minutes }, "CHAT").catch(() => null)
      if (r) {
        extra = `${r.stand.message}.`.replace(/\.\./g, ".")
        if (r.activityId) undoParts.push({ kind: "UNDO_EVENT", eventId: r.activityId })
      }
    }
  }
  const event = await recordActivity(userId, {
    type: "LOGGED",
    itemType: "METRIC",
    itemId: entry.id,
    title: `Timed ${entry.label}: ${duration(minutes)}`,
    minutes,
    source: "CHAT",
    undo: undoParts.length === 1 ? undoParts[0] : { kind: "MANY", items: undoParts },
  })
  return { text: stoppedReply(entry.label, minutes, extra), activityId: event?.id }
}

const start = async (userId: string, tz: string, what: string | null): Promise<ChatResult> => {
  const prev = await running(userId)
  let stoppedPrev: { label: string; minutes: number } | null = null
  if (prev) {
    const mins = elapsedMinutes(prev.startedAt, new Date())
    if (isForgotten(mins)) return reply(forgottenReply(prev.label, mins))
    await finish(userId, prev, mins)
    stoppedPrev = { label: prev.label, minutes: mins }
  }
  const link = what ? await linkFor(userId, what) : null
  const label = (link?.title ?? what ?? "timer").toLowerCase()
  const entry = await prisma.timeEntry.create({
    data: { userId, label, itemType: link?.itemType ?? null, itemId: link?.itemId ?? null, date: dateFromKey(dayKeyInTz(new Date(), tz)) },
  })
  const event = await recordActivity(userId, {
    type: "CREATED",
    itemType: "METRIC",
    itemId: entry.id,
    title: `Timer started: ${label}`,
    source: "CHAT",
    undo: { kind: "DELETE_TIME_ENTRY", entryId: entry.id },
  })
  return reply(startedReply(label, stoppedPrev), [{ type: "TIMER_STARTED", id: entry.id, title: event?.title ?? `Timer started: ${label}`, activityId: event?.id }])
}

const stop = async (userId: string, minutes: number | null): Promise<ChatResult> => {
  const entry = await running(userId)
  if (!entry) return reply('No timer is running. Say "start timer for DSA" to begin one.')
  const mins = minutes ?? elapsedMinutes(entry.startedAt, new Date())
  // A forgotten timer is only closed with a number the person gives.
  if (minutes === null && isForgotten(mins)) return reply(forgottenReply(entry.label, mins))
  const done = await finish(userId, entry, mins)
  return reply(done.text, [{ type: "TIMER_STOPPED", id: entry.id, title: `Timed ${entry.label}: ${duration(mins)}`, minutes: mins, activityId: done.activityId }])
}

const status = async (userId: string): Promise<ChatResult> => {
  const entry = await running(userId)
  if (!entry) return reply('No timer is running. Say "start timer for DSA" to begin one.')
  const mins = elapsedMinutes(entry.startedAt, new Date())
  return reply(isForgotten(mins) ? forgottenReply(entry.label, mins) : `${entry.label}: ${duration(mins)} so far.`)
}

const discard = async (userId: string): Promise<ChatResult> => {
  const entry = await running(userId)
  if (!entry) return reply("No timer is running.")
  await prisma.timeEntry.delete({ where: { id: entry.id } })
  const event = await recordActivity(userId, {
    type: "DELETED",
    itemType: "METRIC",
    itemId: entry.id,
    title: `Timer discarded: ${entry.label}`,
    source: "CHAT",
    undo: { kind: "RESTORE_TIME_ENTRY", entry: { label: entry.label, itemType: entry.itemType, itemId: entry.itemId, startedAt: entry.startedAt.toISOString(), date: entry.date.toISOString() } },
  })
  return reply(`Discarded the ${entry.label} timer. Nothing was saved.`, [{ type: "TIMER_STOPPED", id: entry.id, title: `Timer discarded: ${entry.label}`, minutes: 0, activityId: event?.id }])
}

const where = async (userId: string, tz: string, period: Extract<TimeIntent, { kind: "WHERE" }>["period"]): Promise<ChatResult> => {
  const range = periodRange(period, dayKeyInTz(new Date(), tz))
  const [rows, now] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { userId, endedAt: { not: null }, minutes: { gt: 0 }, date: { gte: dateFromKey(range.from), lte: dateFromKey(range.to) } },
      select: { label: true, minutes: true },
    }),
    running(userId),
  ])
  return reply(whereTimeWent(rows.map((r) => ({ label: r.label, minutes: r.minutes ?? 0 })), period, now?.label ?? null))
}

export const timeChat = async (userId: string, intent: TimeIntent): Promise<ChatResult> => {
  const tz = await getUserTimezone(userId)
  switch (intent.kind) {
    case "START":
      return start(userId, tz, intent.what)
    case "STOP":
      return stop(userId, intent.minutes)
    case "STATUS":
      return status(userId)
    case "DISCARD":
      return discard(userId)
    case "WHERE":
      return where(userId, tz, intent.period)
  }
}
