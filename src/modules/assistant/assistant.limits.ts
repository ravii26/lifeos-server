/* =====================================================================
   Limits in chat (doc 18 item 5, ADR 0037): "limit Instagram to 1 hour",
   "no sugar", "spent 40 min on instagram", "how's my instagram limit?".
   A limit is a habit with isLimit = true (the cap is targetMinutes or
   targetCount). All code, no AI. Its logs are never "completed", so no
   done-count, adherence or weekly summary ever picks them up.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { logHabitService } from "../habit/habit.service.js"
import { dateFromKey, dayKeyInTz, localDateOnly } from "../../shared/utils/time.util.js"
import { createdReply, duration, limitLine, limitStatus, type LimitIntent } from "../log/limits.rules.js"
import { matchCountHabit } from "../log/log.rules.js"
import type { ChatResult } from "./assistant.chat.js"

const DAY_MS = 86_400_000

const reply = (text: string, actions: ChatResult["actions"] = []): ChatResult => ({ role: "ASSISTANT", reply: text, actions, usedAi: false })

type LimitHabit = { id: string; title: string; habitType: "BOOLEAN" | "COUNT" | "TIMER"; targetMinutes: number | null; targetCount: number | null; createdAt: Date }

export const limitHabits = (userId: string): Promise<LimitHabit[]> =>
  prisma.habit.findMany({
    where: { userId, isActive: true, isLimit: true },
    select: { id: true, title: true, habitType: true, targetMinutes: true, targetCount: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })

const perOf = (h: LimitHabit): "TIME" | "COUNT" => (h.habitType === "TIMER" ? "TIME" : "COUNT")
const maxOf = (h: LimitHabit): number => (h.habitType === "TIMER" ? h.targetMinutes ?? 0 : h.targetCount ?? 0)

// The last 7 days of what was logged, and how that sits against the cap.
export const statusLine = async (userId: string, tz: string, h: LimitHabit): Promise<string> => {
  const todayKey = dayKeyInTz(new Date(), tz)
  const since = dateFromKey(todayKey).getTime() - 6 * DAY_MS
  const logs = await prisma.habitLog.findMany({ where: { habitId: h.id, userId, date: { gte: new Date(since) } }, select: { date: true, minutes: true, count: true } })
  const per = perOf(h)
  const days = logs.map((l) => ({ date: l.date.toISOString().slice(0, 10), used: per === "TIME" ? l.minutes : l.count }))
  return limitLine(h.title, per, maxOf(h), limitStatus(maxOf(h), days, dayKeyInTz(h.createdAt, tz), todayKey))
}

// Limits belong to an area like any habit; use their Main one, else any, else "General".
const areaFor = async (userId: string): Promise<string> => {
  const areas = await prisma.area.findMany({ where: { userId }, select: { id: true, tier: true }, orderBy: { order: "asc" } })
  const found = areas.find((a) => a.tier === "MAIN") ?? areas[0]
  if (found) return found.id
  const made = await prisma.area.create({ data: { userId, name: "General", tier: "MAINTAIN", color: "#8a8a8a", icon: "circle", order: 99 }, select: { id: true } })
  return made.id
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const create = async (userId: string, intent: Extract<LimitIntent, { kind: "CREATE" }>): Promise<ChatResult> => {
  const existing = matchCountHabit(intent.what, await limitHabits(userId))
  if (existing) {
    const per = perOf(existing)
    return reply(`You already have a limit on ${existing.title.toLowerCase()}: ${per === "TIME" ? duration(maxOf(existing)) : maxOf(existing) === 0 ? "none" : `${maxOf(existing)}`} a day. To change it, remove it first ("remove my ${existing.title.toLowerCase()} limit") and set a new one.`)
  }
  const habit = await prisma.habit.create({
    data: {
      userId,
      areaId: await areaFor(userId),
      title: cap(intent.what),
      habitType: intent.per === "TIME" ? "TIMER" : "COUNT",
      ...(intent.per === "TIME" ? { targetMinutes: intent.max } : { targetCount: intent.max }),
      isLimit: true,
      frequency: "DAILY",
    },
    select: { id: true, title: true },
  })
  const detail = intent.per === "TIME" ? `up to ${duration(intent.max)} a day` : intent.max === 0 ? "none" : `up to ${intent.max} a day`
  const event = await recordActivity(userId, {
    type: "CREATED",
    itemType: "HABIT",
    itemId: habit.id,
    title: `Limit: ${habit.title.toLowerCase()}, ${detail}`,
    source: "CHAT",
    undo: { kind: "ARCHIVE_HABIT", habitId: habit.id },
  })
  return reply(createdReply(intent.what, intent.per, intent.max), [
    { type: "LIMIT_SET", id: habit.id, title: event?.title ?? `Limit: ${habit.title}`, detail, activityId: event?.id },
  ])
}

const useTime = async (userId: string, tz: string, intent: Extract<LimitIntent, { kind: "USE_TIME" }>): Promise<ChatResult | null> => {
  const habit = matchCountHabit(intent.what, (await limitHabits(userId)).filter((h) => h.habitType === "TIMER"))
  if (!habit) return null // not clearly one of their limits: the weekly targets or the AI decide
  const prev = await prisma.habitLog.findUnique({ where: { habitId_date: { habitId: habit.id, date: localDateOnly(new Date(), tz) } }, select: { minutes: true } })
  const r = await logHabitService(habit.id, userId, { minutes: (prev?.minutes ?? 0) + intent.minutes, completed: false }, { source: "CHAT" })
  const line = await statusLine(userId, tz, habit)
  return reply(line, [{ type: "LIMIT_USED", id: habit.id, title: habit.title, detail: line, activityId: r.activityId }])
}

const ask = async (userId: string, tz: string, intent: Extract<LimitIntent, { kind: "ASK" }>): Promise<ChatResult | null> => {
  const all = await limitHabits(userId)
  if (all.length === 0) return reply('You haven\'t set any limits yet. Try "limit Instagram to 1 hour" or "no sugar".')
  const picked = intent.what ? [matchCountHabit(intent.what, all)].filter((h): h is LimitHabit => !!h) : all
  if (picked.length === 0) return null
  const lines = await Promise.all(picked.map((h) => statusLine(userId, tz, h)))
  return reply(lines.join("\n"))
}

export const limitChat = async (userId: string, tz: string, intent: LimitIntent): Promise<ChatResult | null> => {
  if (intent.kind === "CREATE") return create(userId, intent)
  if (intent.kind === "USE_TIME") return useTime(userId, tz, intent)
  return ask(userId, tz, intent)
}
