/* =====================================================================
   The Log and limits on the phone (Phase D slice D8, ADR 0045): one read
   that fills the "Log and limits" screen, plus +1 on a count and removing
   a Log entry. Same numbers and wording as the chat answers (log.rules.ts,
   limits.rules.ts); nothing here judges or counts a streak.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { dateFromKey, dayKeyInTz } from "../../shared/utils/time.util.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import { recordActivity } from "../activity/activity.service.js"
import { limitHabits, statusLine } from "../assistant/assistant.limits.js"
import { countHabitById } from "../assistant/assistant.log.js"
import { categoryOf, latestPerDay, periodRange, type LogRow } from "./log.rules.js"

const DAY_MS = 86_400_000

const rows = async (userId: string, series: string, from: string, to: string): Promise<(LogRow & { id: string; unit: string })[]> => {
  const found = await prisma.logEntry.findMany({ where: { userId, series, date: { gte: dateFromKey(from), lte: dateFromKey(to) } }, orderBy: { createdAt: "asc" } })
  return found.map((r) => ({ id: r.id, unit: r.unit, value: r.value, label: r.label, date: r.date.toISOString().slice(0, 10), createdAt: r.createdAt }))
}

// Count habits with today's number ("Water 3 of 8"), for Now and the Log screen.
export const countsTodayService = async (userId: string) => {
  const tz = await getUserTimezone(userId)
  const todayKey = dayKeyInTz(new Date(), tz)
  const habits = await prisma.habit.findMany({
    where: { userId, isActive: true, isLimit: false, habitType: "COUNT" },
    select: { id: true, title: true, targetCount: true, logs: { where: { date: dateFromKey(todayKey) }, select: { count: true } } },
    take: 12,
  })
  return habits.map((h) => ({ id: h.id, title: h.title, count: h.logs[0]?.count ?? 0, target: h.targetCount }))
}

export const logOverviewService = async (userId: string) => {
  const tz = await getUserTimezone(userId)
  const todayKey = dayKeyInTz(new Date(), tz)
  const month = periodRange("MONTH", todayKey)
  const last7 = periodRange("LAST_7", todayKey)
  const since90 = new Date(dateFromKey(todayKey).getTime() - 89 * DAY_MS).toISOString().slice(0, 10)

  const [money, sleep, weight, recent, counts, limits] = await Promise.all([
    rows(userId, "money", month.from, month.to),
    rows(userId, "sleep", last7.from, last7.to),
    rows(userId, "weight", since90, todayKey),
    prisma.logEntry.findMany({ where: { userId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 20 }),
    prisma.habit.findMany({
      where: { userId, isActive: true, isLimit: false, habitType: "COUNT" },
      select: { id: true, title: true, targetCount: true, logs: { where: { date: dateFromKey(todayKey) }, select: { count: true } } },
    }),
    limitHabits(userId),
  ])

  const byCategory = new Map<string, number>()
  for (const r of money) byCategory.set(categoryOf(r.label), (byCategory.get(categoryOf(r.label)) ?? 0) + r.value)
  const sleepDays = latestPerDay(sleep)
  const weightDays = latestPerDay(weight)

  return {
    money: {
      monthTotal: money.reduce((s, r) => s + r.value, 0),
      entries: money.length,
      byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([category, total]) => ({ category, total })),
    },
    sleep: {
      nights: sleepDays.length,
      average: sleepDays.length ? sleepDays.reduce((s, r) => s + r.value, 0) / sleepDays.length : null,
      latest: sleepDays.length ? sleepDays[sleepDays.length - 1]!.value : null,
    },
    weight: {
      readings: weightDays.length,
      latest: weightDays.length ? weightDays[weightDays.length - 1]!.value : null,
      first: weightDays.length ? weightDays[0]!.value : null,
      firstDate: weightDays.length ? weightDays[0]!.date : null,
    },
    counts: counts.map((h) => ({ id: h.id, title: h.title, count: h.logs[0]?.count ?? 0, target: h.targetCount })),
    limits: await Promise.all(limits.map(async (h) => ({ id: h.id, title: h.title, line: await statusLine(userId, tz, h) }))),
    recent: recent.map((r) => ({ id: r.id, series: r.series, value: r.value, unit: r.unit, label: r.label, date: r.date.toISOString().slice(0, 10) })),
  }
}

// +1 (or n) on a count habit, the same as "+1 water" in chat. Returns the line to show.
export const addToCountService = async (userId: string, habitId: string, n: number) => {
  const tz = await getUserTimezone(userId)
  return countHabitById(userId, tz, habitId, n)
}

// Removes one Log entry; Undo (RESTORE_LOG_ENTRY) puts it back.
export const removeLogEntryService = async (userId: string, id: string) => {
  const row = await prisma.logEntry.findFirst({ where: { id, userId } })
  if (!row) return null
  await prisma.logEntry.delete({ where: { id } })
  const event = await recordActivity(userId, {
    type: "DELETED",
    itemType: "METRIC",
    itemId: id,
    title: `Removed ${row.series} entry`,
    source: "APP",
    undo: { kind: "RESTORE_LOG_ENTRY", entry: { series: row.series, value: row.value, unit: row.unit, label: row.label, date: row.date.toISOString() } },
  })
  return { id, activityId: event?.id }
}
