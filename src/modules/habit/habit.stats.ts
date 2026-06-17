/* ===================================================================
   Habit stats — pure functions that derive streaks / today-status from
   a habit's logs. Used by GET /habits (B4) and by area scoring (A2), so
   the math lives in one place.
   =================================================================== */

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

// "YYYY-MM-DD" key in UTC (matches the @db.Date storage).
const dayKey = (d: Date): string =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10)

const addDays = (d: Date, n: number): Date => {
  const c = new Date(d)
  c.setUTCDate(c.getUTCDate() + n)
  return c
}

/**
 * Compute streaks and recent history from a habit's completed logs.
 * @param logs   the habit's logs (any order)
 * @param window how many trailing days to include in `history` (default 28)
 */
export const computeHabitStats = (logs: LogLike[], window = 28): HabitStats => {
  const done = new Set(logs.filter((l) => l.completed).map((l) => dayKey(l.date)))

  const today = new Date()
  const todayKey = dayKey(today)
  const todayDone = done.has(todayKey)

  // Current streak: start at today (or yesterday if today not yet logged),
  // walk backwards while each day is present.
  let currentStreak = 0
  let cursor = todayDone ? today : addDays(today, -1)
  while (done.has(dayKey(cursor))) {
    currentStreak += 1
    cursor = addDays(cursor, -1)
  }

  // Longest streak: scan all completed days for the longest consecutive run.
  let longestStreak = 0
  if (done.size) {
    const sorted = [...done].sort()
    let run = 1
    longestStreak = 1
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1] + "T00:00:00Z")
      const expected = dayKey(addDays(prev, 1))
      run = sorted[i] === expected ? run + 1 : 1
      if (run > longestStreak) longestStreak = run
    }
  }

  // Trailing-window history, oldest → newest.
  const history: boolean[] = []
  for (let i = window - 1; i >= 0; i--) {
    history.push(done.has(dayKey(addDays(today, -i))))
  }

  return { currentStreak, longestStreak, todayDone, history }
}
