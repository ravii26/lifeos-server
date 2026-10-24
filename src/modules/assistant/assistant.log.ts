/* =====================================================================
   Counts and Log in chat (doc 18 item 4, ADR 0036): "+1 water",
   "spent 250 on lunch", "slept 6 hours", "weight 74", and questions about
   them. All code, no AI. Every write has Undo; every number comes from the
   person's own data. Anything unclear returns null so the AI decides.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { logHabitService } from "../habit/habit.service.js"
import { logProgressService } from "../progress/progress.service.js"
import { dateFromKey, dayKeyInTz, localDateOnly } from "../../shared/utils/time.util.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import {
  answerSleep,
  answerSpend,
  answerWeight,
  entryReceipt,
  logIntent,
  matchCountHabit,
  periodRange,
  type LogIntent,
  type LogPeriod,
  type LogRow,
  type LogSeries,
} from "../log/log.rules.js"
import { limitIntent } from "../log/limits.rules.js"
import { limitChat, statusLine } from "./assistant.limits.js"
import { timeIntent } from "../log/time.rules.js"
import { listChat } from "./assistant.lists.js"
import { dietChat } from "./assistant.diet.js"
import { peopleChat } from "./assistant.people.js"
import { savesChat } from "./assistant.saves.js"
import { timeChat } from "./assistant.time.js"
import type { ChatResult } from "./assistant.chat.js"

const DAY_MS = 86_400_000

const reply = (text: string, actions: ChatResult["actions"] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })

const rowsFor = async (userId: string, series: LogSeries, from: string, to: string): Promise<LogRow[]> => {
  const found = await prisma.logEntry.findMany({
    where: { userId, series, date: { gte: dateFromKey(from), lte: dateFromKey(to) } },
    orderBy: { createdAt: "asc" },
  })
  return found.map((r) => ({ value: r.value, label: r.label, date: r.date.toISOString().slice(0, 10), createdAt: r.createdAt }))
}

const addEntry = async (userId: string, tz: string, e: Extract<LogIntent, { kind: "ENTRY" }>): Promise<ChatResult> => {
  const dateKey = dayKeyInTz(new Date(Date.now() + e.dayOffset * DAY_MS), tz)
  const row = await prisma.logEntry.create({
    data: { userId, series: e.series, value: e.value, unit: e.unit, label: e.label, date: dateFromKey(dateKey) },
  })
  // Money shows the month so far; sleep and weight need no running total.
  let monthTotal: number | undefined
  if (e.series === "money") {
    const range = periodRange("MONTH", dayKeyInTz(new Date(), tz))
    monthTotal = (await rowsFor(userId, "money", range.from, range.to)).reduce((s, r) => s + r.value, 0)
  }
  const text = entryReceipt(e, monthTotal)
  const event = await recordActivity(userId, {
    type: "LOGGED",
    itemType: "METRIC",
    itemId: row.id,
    title: text.replace(/\.$/, ""),
    value: e.value,
    source: "CHAT",
    undo: { kind: "DELETE_LOG_ENTRY", entryId: row.id },
  })
  return reply(e.dayOffset === -1 ? `${text} Saved for yesterday.` : text, [
    { type: "LOG_ADDED", series: e.series, value: e.value, unit: e.unit, label: e.label, title: event?.title ?? text, activityId: event?.id },
  ])
}

type CountHabit = { id: string; title: string; habitType: "BOOLEAN" | "COUNT" | "TIMER"; targetCount: number | null; targetMinutes: number | null; isLimit: boolean; createdAt: Date }

// Adds n to today's count on a count habit (a limit or an ordinary one) and says where that leaves it.
const bump = async (userId: string, tz: string, habit: CountHabit, n: number, source: "CHAT" | "APP" | "NOTIFICATION"): Promise<ChatResult> => {
  const today = localDateOnly(new Date(), tz)
  const prev = await prisma.habitLog.findUnique({ where: { habitId_date: { habitId: habit.id, date: today } }, select: { count: true } })
  const count = (prev?.count ?? 0) + n
  const done = habit.targetCount ? count >= habit.targetCount : true
  // A limit's logs are never "completed": it is a cap, not something to finish.
  const r = await logHabitService(habit.id, userId, { count, completed: habit.isLimit ? false : done }, { source })
  if (habit.isLimit) {
    const line = await statusLine(userId, tz, habit)
    return reply(line, [{ type: "COUNT_ADDED", habitId: habit.id, title: habit.title, count, target: habit.targetCount ?? null, detail: `${count}/${habit.targetCount ?? 0}`, activityId: r.activityId }])
  }
  const of = habit.targetCount ? ` of ${habit.targetCount}` : ""
  const text = `${habit.title}: ${count}${of}.${habit.targetCount && done && (prev?.count ?? 0) < habit.targetCount ? " That's today's target." : ""}`
  return reply(text, [{ type: "COUNT_ADDED", habitId: habit.id, title: habit.title, count, target: habit.targetCount ?? null, detail: `${count}${of}`, activityId: r.activityId }])
}

const COUNT_SELECT = { id: true, title: true, habitType: true, targetCount: true, targetMinutes: true, isLimit: true, createdAt: true } as const

const addCount = async (userId: string, tz: string, c: Extract<LogIntent, { kind: "COUNT" }>): Promise<ChatResult | null> => {
  const habits = await prisma.habit.findMany({ where: { userId, isActive: true, habitType: "COUNT" }, select: COUNT_SELECT })
  const habit = matchCountHabit(c.what, habits)
  if (!habit) return null // not clearly one of their count habits: the AI decides
  return bump(userId, tz, habit, c.n, "CHAT")
}

// Water and the like go to Health when there is one, else the Main area, else any.
const countAreaFor = async (userId: string): Promise<string> => {
  const areas = await prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true, tier: true }, orderBy: { order: "asc" } })
  const found = areas.find((a) => /health|fitness|body/i.test(a.name)) ?? areas.find((a) => a.tier === "MAIN") ?? areas[0]
  if (found) return found.id
  const made = await prisma.area.create({ data: { userId, name: "Health", tier: "SECONDARY", color: "#8a8a8a", icon: "circle", order: 99 }, select: { id: true } })
  return made.id
}

const capFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

// "track water, 8 glasses a day": a count habit with a daily target. A yes/no
// habit of the same name ("Drink water") becomes the count, so there is one
// place for it; a count that exists just gets the new target. All undoable.
const trackCount = async (userId: string, t: Extract<LogIntent, { kind: "TRACK" }>): Promise<ChatResult> => {
  const habits = await prisma.habit.findMany({ where: { userId, isActive: true, isLimit: false }, select: COUNT_SELECT })
  const same = matchCountHabit(t.what, habits)
  const per = `${t.target}${t.unit ? ` ${t.unit}` : ""} a day`
  const howTo = `Say "+1 ${t.what}" each time, or tap +1 on Now.`
  if (same) {
    if (same.habitType === "COUNT" && same.targetCount === t.target) return reply(`You're already counting ${same.title.toLowerCase()}: ${per}. ${howTo}`)
    await prisma.habit.update({ where: { id: same.id }, data: { habitType: "COUNT", targetCount: t.target } })
    const event = await recordActivity(userId, {
      type: "UPDATED",
      itemType: "HABIT",
      itemId: same.id,
      title: `${same.title}: ${per}`,
      source: "CHAT",
      undo: { kind: "RESTORE_FIELDS", model: "habit", id: same.id, prev: { habitType: same.habitType, targetCount: same.targetCount } },
    })
    return reply(`Okay. ${same.title} is now counted: ${per}. ${howTo}`, [{ type: "HABIT_ADDED", id: same.id, title: event?.title ?? same.title }])
  }
  const habit = await prisma.habit.create({
    data: { userId, areaId: await countAreaFor(userId), title: capFirst(t.what), habitType: "COUNT", targetCount: t.target, frequency: "DAILY" },
    select: { id: true, title: true },
  })
  const event = await recordActivity(userId, {
    type: "CREATED",
    itemType: "HABIT",
    itemId: habit.id,
    title: `${habit.title}: ${per}`,
    source: "CHAT",
    undo: { kind: "ARCHIVE_HABIT", habitId: habit.id },
  })
  return reply(`Okay. I'll count ${t.what}: ${per}. ${howTo}`, [{ type: "HABIT_ADDED", id: habit.id, title: event?.title ?? habit.title }])
}

// +n on a count habit by id (the phone's +1 button, a notification action). Null if it is not theirs.
export const countHabitById = async (userId: string, tz: string, habitId: string, n: number) => {
  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId, isActive: true, habitType: "COUNT" }, select: COUNT_SELECT })
  if (!habit) return null
  const r = await bump(userId, tz, habit, n, "APP")
  const a = r.actions[0] as { count: number; target: number | null; activityId?: string } | undefined
  return { habitId, title: habit.title, count: a?.count ?? 0, target: a?.target ?? null, line: r.reply, activityId: a?.activityId }
}

const DEFAULT_PERIOD: Record<LogSeries, LogPeriod> = { money: "MONTH", sleep: "LAST_7", weight: "LAST_MONTH" }

const answer = async (userId: string, tz: string, q: Extract<LogIntent, { kind: "ASK" }>): Promise<ChatResult> => {
  const todayKey = dayKeyInTz(new Date(), tz)
  const period = q.period ?? DEFAULT_PERIOD[q.series]
  if (q.series === "weight") {
    // The trend reads the last 90 days: one reading says little.
    const start = new Date(dateFromKey(todayKey).getTime() - 89 * DAY_MS).toISOString().slice(0, 10)
    return reply(answerWeight(await rowsFor(userId, "weight", start, todayKey)))
  }
  const range = periodRange(period, todayKey)
  const rows = await rowsFor(userId, q.series, range.from, range.to)
  return reply(q.series === "money" ? answerSpend(rows, period, q.label) : answerSleep(rows, period))
}

// A weight goal already has a place for its readings: the project's metric.
// Weight said in chat goes there, so the trend and forecast keep working.
const weightProject = (userId: string) =>
  prisma.project.findFirst({
    where: { userId, status: "ACTIVE", kind: "OUTCOME", metric: { name: { contains: "weight", mode: "insensitive" } } },
    select: { id: true },
  })

export const logChat = async (userId: string, text: string): Promise<ChatResult | null> => {
  const timed = timeIntent(text)
  if (timed) return timeChat(userId, timed)
  const limit = limitIntent(text)
  if (limit) {
    const r = await limitChat(userId, await getUserTimezone(userId), limit)
    if (r) return r
  }
  const dieted = await dietChat(userId, text)
  if (dieted) return dieted
  const listed = await listChat(userId, text)
  if (listed) return listed
  const queued = await savesChat(userId, text)
  if (queued) return queued
  const person = await peopleChat(userId, text)
  if (person) return person
  const intent = logIntent(text)
  if (!intent) return null
  if ((intent.kind === "ENTRY" || intent.kind === "ASK") && intent.series === "weight") {
    const project = await weightProject(userId)
    if (project) {
      if (intent.kind === "ASK") return null // "where do I stand" is answered from the project
      const r = await logProgressService(userId, { projectId: project.id, value: intent.value }, "CHAT")
      return {
        role: "ASSISTANT",
        reply: `Logged ${r.what}. ${r.stand.message}.`.replace(/\.\./g, "."),
        actions: [{ type: "PROGRESS_LOGGED", id: r.stand.id, title: r.stand.title, what: r.what, message: r.stand.message, activityId: r.activityId }],
        usedAi: false,
      }
    }
  }
  const tz = await getUserTimezone(userId)
  if (intent.kind === "ENTRY") return addEntry(userId, tz, intent)
  if (intent.kind === "COUNT") return addCount(userId, tz, intent)
  if (intent.kind === "TRACK") return trackCount(userId, intent)
  return answer(userId, tz, intent)
}
