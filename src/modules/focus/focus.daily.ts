// Splits a focus session across the calendar days it spans, in the USER's
// timezone.
//
// A session from 23:00 to 09:00 next day is one DB row with durationMinutes=600,
// but for a per-day view those 600 minutes belong partly to each LOCAL day. This
// returns fractional minutes per local day-key (YYYY-MM-DD); callers sum across
// sessions and round once at the end to avoid per-session rounding drift.

import {
  dayKeyInTz,
  utcDayKey,
  dateFromKey,
  addUtcDays,
  localDayStartMs,
} from "../../shared/utils/time.util.js"

export interface DailyFocusBucket {
  date: string // YYYY-MM-DD (user's local day)
  minutes: number
}

// Returns { "YYYY-MM-DD": fractionalMinutes } for the span [startedAt, endedAt),
// keyed and split on the user's LOCAL day boundaries.
export const splitFocusByDay = (
  startedAt: Date,
  endedAt: Date,
  timeZone: string,
): Record<string, number> => {
  const buckets: Record<string, number> = {}
  let cursor = startedAt.getTime()
  const end = endedAt.getTime()
  if (!(end > cursor)) return buckets

  while (cursor < end) {
    const key = dayKeyInTz(new Date(cursor), timeZone)
    const nextKey = utcDayKey(addUtcDays(dateFromKey(key), 1))
    const segEnd = Math.min(localDayStartMs(nextKey, timeZone), end)
    // Safety against pathological offset math — never loop without advancing.
    if (segEnd <= cursor) break
    buckets[key] = (buckets[key] ?? 0) + (segEnd - cursor) / 60000
    cursor = segEnd
  }
  return buckets
}

// Aggregates many sessions into a sorted, rounded per-day breakdown.
// Each session's span is clamped to [windowStart, windowEnd] so minutes outside
// the requested range are excluded. Running sessions (no endedAt) use `now`.
export const aggregateDailyFocus = (
  sessions: { startedAt: Date; endedAt: Date | null }[],
  windowStart: Date,
  windowEnd: Date,
  timeZone: string,
  now: Date = new Date(),
): DailyFocusBucket[] => {
  const totals: Record<string, number> = {}
  const winStart = windowStart.getTime()
  const winEnd = windowEnd.getTime()

  for (const s of sessions) {
    const rawEnd = (s.endedAt ?? now).getTime()
    const start = Math.max(s.startedAt.getTime(), winStart)
    const end = Math.min(rawEnd, winEnd)
    if (!(end > start)) continue

    const split = splitFocusByDay(new Date(start), new Date(end), timeZone)
    for (const [date, mins] of Object.entries(split)) {
      totals[date] = (totals[date] ?? 0) + mins
    }
  }

  return Object.entries(totals)
    .map(([date, minutes]) => ({ date, minutes: Math.round(minutes) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
