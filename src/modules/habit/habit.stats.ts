/* ===================================================================
   Habit stats — pure functions that derive streaks / today-status from
   a habit's logs, computed against the USER's timezone. Used by GET
   /habits (B4), area scoring (A2), goal confidence and the coach, so the
   math lives in one place.
   =================================================================== */
import {
  utcDayKey,
  dayKeyInTz,
  dateFromKey,
  addUtcDays,
} from "../../shared/utils/time.util.js"

export interface HabitStats {
  currentStreak: number
  longestStreak: number
  todayDone: boolean
  // Last `window` days as booleans, oldest → newest (for heat-strips).
  history: boolean[]
}

interface LogLike {
  date: Date
  completed: boolean
}

/**
 * Compute streaks and recent history from a habit's completed logs.
 * @param logs     the habit's logs (any order); each log.date is a stored @db.Date
 * @param window   how many trailing days to include in `history` (default 28)
 * @param timeZone the user's IANA timezone — defines "today" (default UTC)
 * @param now      injectable clock (tests)
 */
export const computeHabitStats = (
  logs: LogLike[],
  window = 28,
  timeZone = "UTC",
  now: Date = new Date(),
): HabitStats => {
  // Stored log dates are midnight-UTC date-only → read their day with utcDayKey.
  const done = new Set(logs.filter((l) => l.completed).map((l) => utcDayKey(l.date)))

  // "Today" is the user's LOCAL calendar day, anchored at midnight UTC so the
  // day arithmetic below stays in one coordinate system.
  const todayKey = dayKeyInTz(now, timeZone)
  const today = dateFromKey(todayKey)
  const todayDone = done.has(todayKey)

  // Current streak: start at today (or yesterday if today not yet logged),
  // walk backwards while each day is present.
  let currentStreak = 0
  let cursor = todayDone ? today : addUtcDays(today, -1)
  while (done.has(utcDayKey(cursor))) {
    currentStreak += 1
    cursor = addUtcDays(cursor, -1)
  }

  // Longest streak: scan all completed days for the longest consecutive run.
  let longestStreak = 0
  if (done.size) {
    const sorted = [...done].sort()
    let run = 1
    longestStreak = 1
    for (let i = 1; i < sorted.length; i++) {
      const expected = utcDayKey(addUtcDays(dateFromKey(sorted[i - 1]), 1))
      run = sorted[i] === expected ? run + 1 : 1
      if (run > longestStreak) longestStreak = run
    }
  }

  // Trailing-window history, oldest → newest.
  const history: boolean[] = []
  for (let i = window - 1; i >= 0; i--) {
    history.push(done.has(utcDayKey(addUtcDays(today, -i))))
  }

  return { currentStreak, longestStreak, todayDone, history }
}
