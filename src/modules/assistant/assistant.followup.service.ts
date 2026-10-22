/* =====================================================================
   Carrying out the follow-ups and answering the questions that
   assistant.followup.ts recognises. All code, no AI; every change is
   undoable (RESTORE_FIELDS) and comes back as an ITEM_UPDATED action so
   the phone can reschedule its notifications.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { recordActivity, undoActivityService } from "../activity/activity.service.js"
import { addUtcDays, dateFromKey, localDayStartMs, utcDayKey } from "../../shared/utils/time.util.js"
import { getClock, type Clock } from "../now/now.service.js"
import { restOfTodayService } from "../now/agenda.service.js"
import { respondNowService } from "../now/plan.service.js"
import { respondProjectService } from "../now/brain.actions.js"
import { formatAmount, targetPace } from "../now/brain.rules.js"
import { weeklyTargets } from "../now/brain.service.js"
import { listStandsService } from "../progress/progress.service.js"
import {
  daysAhead,
  followUpIntent,
  lastRef,
  matchByTitle,
  resolveHour,
  type ChatRef,
  type FollowUp,
} from "./assistant.followup.js"
import type { ChatAction, ChatResult } from "./assistant.chat.js"

export type HistoryTurn = { role: "user" | "assistant"; text: string; refs?: ChatRef[] }

const pad = (n: number) => String(n).padStart(2, "0")
const keyPlus = (key: string, n: number) => utcDayKey(addUtcDays(dateFromKey(key), n))

const timeIn = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\s?([ap])\.?m\.?/i, " $1m")
const dayLabel = (key: string, todayKey: string) => {
  if (key === todayKey) return "today"
  if (key === keyPlus(todayKey, 1)) return "tomorrow"
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
}

// Minutes after local midnight for a moment, in the person's zone.
const localMin = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d)
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0)
  return h * 60 + m
}
const localKey = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d)
const at = (key: string, min: number, tz: string) => new Date(localDayStartMs(key, tz) + min * 60_000)

const reply = (text: string, actions: ChatAction[] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })

// ---- questions ----------------------------------------------------------

const answerDay = async (userId: string): Promise<ChatResult> => {
  const { c, input, reminders, busyUntil } = await restOfTodayService(userId)
  if (input.mode === "SICK") return reply("You're in sick mode, so nothing is planned. Rest; I'll pick things up when you're better.")
  const lines: string[] = []
  if (busyUntil) lines.push(`You're busy until ${timeIn(busyUntil, c.tz)}.`)
  const fmtBlock = (hhmm: string) => timeIn(at(c.todayKey, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), c.tz), c.tz)
  for (const b of input.suggested) {
    const name = b.block === "NIGHT" ? "Tonight" : b.block[0] + b.block.slice(1).toLowerCase()
    lines.push(`${name} (${fmtBlock(b.start)}–${b.end === "24:00" ? "midnight" : fmtBlock(b.end)}): ${b.items.map((i) => (i.minutes ? `${i.title} ${i.minutes} min` : i.title)).join(", ")}`)
  }
  if (reminders.length) lines.push(`Reminders: ${reminders.map((r) => `${r.title} at ${timeIn(r.remindAt!, c.tz)}`).join(", ")}`)
  const due = input.due.filter((d) => d.when === "today").map((d) => d.title)
  if (due.length) lines.push(`Due today: ${due.join(", ")}`)
  if (input.doneToday.length) lines.push(`Already done: ${input.doneToday.slice(0, 5).join(", ")}`)
  if (!lines.length || (lines.length === 1 && input.doneToday.length)) {
    return reply(`${input.doneToday.length ? `Done today: ${input.doneToday.slice(0, 5).join(", ")}. ` : ""}Nothing else planned for the rest of today. Rest, or tell me what you'd like to do.`)
  }
  return reply(`Here's the rest of today:\n${lines.join("\n")}`)
}

const answerDoneOn = async (userId: string, day: "TODAY" | "YESTERDAY"): Promise<ChatResult> => {
  const c = await getClock(userId)
  const key = day === "TODAY" ? c.todayKey : keyPlus(c.todayKey, -1)
  const rows = await prisma.activityEvent.findMany({
    where: {
      userId, type: { in: ["DONE", "MINIMUM", "LOGGED"] }, undoneAt: null, source: { not: "SYSTEM" },
      at: { gte: new Date(localDayStartMs(key, c.tz)), lt: new Date(localDayStartMs(keyPlus(key, 1), c.tz)) },
    },
    orderBy: { at: "asc" },
    select: { title: true, minutes: true, type: true },
  })
  const label = day === "TODAY" ? "Today" : "Yesterday"
  if (!rows.length) return reply(day === "TODAY" ? "Nothing ticked yet today, and that's okay. Want the next thing?" : "Nothing logged yesterday. Today is a fresh one.")
  const items = rows.map((r) => `${r.title ?? "Something"}${r.minutes ? ` (${r.minutes} min)` : ""}${r.type === "MINIMUM" ? " (small version)" : ""}`)
  const total = rows.reduce((s, r) => s + (r.minutes ?? 0), 0)
  return reply(`${label} you did: ${items.join(", ")}.${total >= 30 ? ` About ${formatAmount(total, "min", null)} in all.` : ""}`)
}

const answerOnTrack = async (userId: string, what: string | null): Promise<ChatResult> => {
  const c = await getClock(userId)
  const [stands, targets] = await Promise.all([listStandsService(userId), weeklyTargets(userId, c)])
  if (!stands.length) return reply("You don't have a goal with a plan yet, so there's nothing to be behind on. Want to plan one?")
  const pick = what ? matchByTitle(what, stands) : null
  const chosen = pick ? [pick] : stands.slice(0, 4)
  const lines = chosen.map((s) => {
    const t = targets.find((x) => x.projectId === s.id)
    if (!t) return `${s.title}: ${s.message}`
    const p = targetPace(t)
    const started = t.weekDays && t.weekDays < 7 ? " (you started mid-week, so this week's share is smaller)" : ""
    const week = `${formatAmount(t.doneThisWeek, t.unit, t.unit === "count" ? t.countUnit : null)} of ${formatAmount(t.target, t.unit, t.countUnit)} this week${started}`
    const left = p.remaining > 0 ? `; ${formatAmount(p.remaining, t.unit, t.countUnit)} left over ${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"}` : "; this week's target is done"
    return `${s.title}: ${week}${left}.`
  })
  const head = pick || chosen.length === 1 ? "" : "Here's where you stand:\n"
  return reply(`${head}${lines.join("\n")}`)
}

// ---- changes to the last thing -----------------------------------------

const moveTask = async (userId: string, c: Clock, id: string, f: Extract<FollowUp, { kind: "MOVE" }>): Promise<ChatResult | null> => {
  const t = await prisma.task.findFirst({ where: { id, userId }, select: { id: true, title: true, dueDate: true, remindAt: true, windowEnd: true, repeatRule: true } })
  if (!t) return null
  const targetKey = keyPlus(c.todayKey, daysAhead(f.when, c.weekday))
  const prev = { dueDate: t.dueDate?.toISOString() ?? null, remindAt: t.remindAt?.toISOString() ?? null, windowEnd: t.windowEnd?.toISOString() ?? null }
  let detail: string
  let data: { dueDate?: Date; remindAt?: Date; windowEnd?: Date | null }
  if (t.remindAt) {
    const min = f.when.kind === "TONIGHT" ? Math.max(localMin(t.remindAt, c.tz), 21 * 60) : localMin(t.remindAt, c.tz)
    const remindAt = at(targetKey, min, c.tz)
    const shift = remindAt.getTime() - t.remindAt.getTime()
    data = { remindAt, windowEnd: t.windowEnd ? new Date(t.windowEnd.getTime() + shift) : null }
    detail = `${dayLabel(targetKey, c.todayKey)} at ${timeIn(remindAt, c.tz)}`
  } else {
    data = { dueDate: dateFromKey(targetKey) }
    detail = dayLabel(targetKey, c.todayKey)
  }
  const updated = await prisma.task.update({ where: { id: t.id }, data, select: { remindAt: true, windowEnd: true, repeatRule: true } })
  const ev = await recordActivity(userId, { type: "UPDATED", itemType: "TASK", itemId: t.id, title: t.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev } })
  return reply(`Moved "${t.title}" to ${detail}.${t.repeatRule ? " It still repeats after that." : ""}`, [
    {
      type: "ITEM_UPDATED", itemType: "TASK", id: t.id, title: t.title, detail: `moved to ${detail}`,
      ...(updated.remindAt && { remindAt: updated.remindAt.toISOString() }),
      ...(updated.windowEnd && { windowEnd: updated.windowEnd.toISOString() }),
      ...(updated.repeatRule && { repeatRule: updated.repeatRule }),
      activityId: ev?.id,
    },
  ])
}

const notToday = async (userId: string, ref: ChatRef): Promise<ChatResult | null> => {
  if (!ref.id) return null
  const r =
    ref.type === "HABIT"
      ? await respondNowService(userId, { sourceType: "HABIT", sourceId: ref.id, action: "SKIP", reason: "moved by chat" }, "CHAT").catch(() => null)
      : await respondProjectService(userId, { projectId: ref.id, action: "SKIP", reason: "moved by chat" }, "CHAT").catch(() => null)
  if (!r) return null
  return reply(`Okay, not today. ${ref.title ? `"${ref.title}"` : "It"} comes back by itself on its next day.`)
}

export const resize = async (userId: string, ref: ChatRef, minutes: number): Promise<ChatResult | null> => {
  if (!ref.id) return null
  const label = formatAmount(minutes, "min", null)
  if (ref.type === "TASK") {
    const t = await prisma.task.findFirst({ where: { id: ref.id, userId }, select: { id: true, title: true, sizeMinutes: true } })
    if (!t) return null
    await prisma.task.update({ where: { id: t.id }, data: { sizeMinutes: minutes } })
    const ev = await recordActivity(userId, { type: "UPDATED", itemType: "TASK", itemId: t.id, title: t.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev: { sizeMinutes: t.sizeMinutes } } })
    return reply(`"${t.title}" is now ${label}.`, [{ type: "ITEM_UPDATED", itemType: "TASK", id: t.id, title: t.title, detail: label, activityId: ev?.id }])
  }
  if (ref.type === "HABIT") {
    const h = await prisma.habit.findFirst({ where: { id: ref.id, userId }, select: { id: true, title: true, targetMinutes: true } })
    if (!h) return null
    await prisma.habit.update({ where: { id: h.id }, data: { targetMinutes: minutes } })
    const ev = await recordActivity(userId, { type: "UPDATED", itemType: "HABIT", itemId: h.id, title: h.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "habit", id: h.id, prev: { targetMinutes: h.targetMinutes } } })
    return reply(`"${h.title}" is now ${label}.`, [{ type: "ITEM_UPDATED", itemType: "HABIT", id: h.id, title: h.title, detail: label, activityId: ev?.id }])
  }
  if (ref.type === "PROJECT") {
    const p = await prisma.project.findFirst({ where: { id: ref.id, userId }, select: { id: true, title: true, sessionMinutes: true } })
    if (!p) return null
    await prisma.project.update({ where: { id: p.id }, data: { sessionMinutes: minutes } })
    const ev = await recordActivity(userId, { type: "UPDATED", itemType: "PROJECT", itemId: p.id, title: p.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "project", id: p.id, prev: { sessionMinutes: p.sessionMinutes } } })
    return reply(`${p.title} sessions are now ${label}.`, [{ type: "ITEM_UPDATED", itemType: "PROJECT", id: p.id, title: p.title, detail: `${label} a session`, activityId: ev?.id }])
  }
  return null
}

export const retime = async (userId: string, c: Clock, ref: ChatRef, hour: number, minute: number, ampm: "am" | "pm" | null): Promise<ChatResult | null> => {
  if (!ref.id) return null
  if (ref.type === "TASK") {
    const t = await prisma.task.findFirst({ where: { id: ref.id, userId }, select: { id: true, title: true, remindAt: true, windowEnd: true, dueDate: true, repeatRule: true } })
    if (!t) return null
    const preferPm = t.remindAt ? localMin(t.remindAt, c.tz) >= 12 * 60 : false
    const h = resolveHour(hour, ampm, c.nowMin, preferPm)
    const baseKey = t.remindAt ? localKey(t.remindAt, c.tz) : t.dueDate ? utcDayKey(t.dueDate) : c.todayKey
    let key = baseKey < c.todayKey ? c.todayKey : baseKey
    let remindAt = at(key, h * 60 + minute, c.tz)
    if (remindAt.getTime() <= Date.now()) {
      key = keyPlus(key, 1)
      remindAt = at(key, h * 60 + minute, c.tz)
    }
    const shift = t.remindAt ? remindAt.getTime() - t.remindAt.getTime() : 0
    const windowEnd = t.windowEnd ? new Date(t.windowEnd.getTime() + shift) : null
    await prisma.task.update({ where: { id: t.id }, data: { remindAt, windowEnd } })
    const ev = await recordActivity(userId, {
      type: "UPDATED", itemType: "TASK", itemId: t.id, title: t.title, source: "CHAT",
      undo: { kind: "RESTORE_FIELDS", model: "task", id: t.id, prev: { remindAt: t.remindAt?.toISOString() ?? null, windowEnd: t.windowEnd?.toISOString() ?? null } },
    })
    const detail = `${dayLabel(key, c.todayKey)} at ${timeIn(remindAt, c.tz)}`
    return reply(`Done. I'll remind you about "${t.title}" ${detail}.`, [
      { type: "ITEM_UPDATED", itemType: "TASK", id: t.id, title: t.title, detail, remindAt: remindAt.toISOString(), ...(windowEnd && { windowEnd: windowEnd.toISOString() }), ...(t.repeatRule && { repeatRule: t.repeatRule }), activityId: ev?.id },
    ])
  }
  if (ref.type === "HABIT") {
    const hb = await prisma.habit.findFirst({ where: { id: ref.id, userId }, select: { id: true, title: true, reminderTime: true } })
    if (!hb) return null
    const preferPm = hb.reminderTime ? Number(hb.reminderTime.slice(0, 2)) >= 12 : false
    const h = resolveHour(hour, ampm, c.nowMin, preferPm)
    const reminderTime = `${pad(h)}:${pad(minute)}`
    await prisma.habit.update({ where: { id: hb.id }, data: { reminderTime } })
    const ev = await recordActivity(userId, { type: "UPDATED", itemType: "HABIT", itemId: hb.id, title: hb.title, source: "CHAT", undo: { kind: "RESTORE_FIELDS", model: "habit", id: hb.id, prev: { reminderTime: hb.reminderTime } } })
    const label = timeIn(at(c.todayKey, h * 60 + minute, c.tz), c.tz)
    return reply(`Got it: "${hb.title}" is at ${label} now${hb.reminderTime ? "" : ", and I'll remind you then"}.`, [
      { type: "ITEM_UPDATED", itemType: "HABIT", id: hb.id, title: hb.title, detail: `at ${label}`, reminderTime, activityId: ev?.id },
    ])
  }
  return null
}

const correct = async (userId: string, c: Clock, f: Extract<FollowUp, { kind: "CORRECT" }>): Promise<ChatResult | null> => {
  const [habits, reminders] = await Promise.all([
    prisma.habit.findMany({ where: { userId, isActive: true }, select: { id: true, title: true } }),
    prisma.task.findMany({ where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, remindAt: { not: null } }, select: { id: true, title: true }, take: 50 }),
  ])
  const options: ChatRef[] = [
    ...habits.map((h) => ({ type: "HABIT" as const, id: h.id, title: h.title })),
    ...reminders.map((r) => ({ type: "TASK" as const, id: r.id, title: r.title })),
  ]
  const hit = matchByTitle(f.what, options.map((o) => ({ ...o, title: o.title ?? "" })))
  return hit ? retime(userId, c, hit, f.hour, f.minute, f.ampm) : null
}

const undoLast = async (userId: string, history: HistoryTurn[]): Promise<ChatResult | null> => {
  const ref = lastRef(
    history.map((t) => ({ ...t, refs: t.refs?.filter((r) => r.activityId) })),
    ["TASK", "HABIT", "PROJECT", "NOTE"],
  )
  if (!ref?.activityId) return null
  try {
    await undoActivityService(userId, ref.activityId)
  } catch {
    return reply("That one is already undone, or can't be undone.")
  }
  return reply(`Undone${ref.title ? `: ${ref.title}` : ""}.`, [{ type: "UNDONE", itemType: ref.type, id: ref.id ?? null, title: ref.title ?? "" }])
}

// The entry: a ChatResult when code understood the message, else null (the AI decides).
// PLAN_CHANGE is returned as a signal for the chat, which owns the goal planner reply.
export const followUpChat = async (userId: string, text: string, history: HistoryTurn[]): Promise<ChatResult | "PLAN_CHANGE" | null> => {
  const planRef = lastRef(history, ["GOAL_PLAN"])
  const f = followUpIntent(text, !!planRef?.goalText)
  if (!f) return null
  switch (f.kind) {
    case "DAY":
      return answerDay(userId)
    case "DONE_ON":
      return answerDoneOn(userId, f.day)
    case "ON_TRACK":
      return answerOnTrack(userId, f.what)
    case "UNDO":
      return undoLast(userId, history)
    case "PLAN_CHANGE":
      return "PLAN_CHANGE"
    case "CORRECT":
      return correct(userId, await getClock(userId), f)
  }
  const ref = lastRef(history, ["TASK", "HABIT", "PROJECT"])
  if (!ref) return null
  const c = await getClock(userId)
  if (f.kind === "MOVE") return ref.type === "TASK" && ref.id ? moveTask(userId, c, ref.id, f) : notToday(userId, ref)
  if (f.kind === "RESIZE") return resize(userId, ref, f.minutes)
  return retime(userId, c, ref, f.hour, f.minute, f.ampm)
}
