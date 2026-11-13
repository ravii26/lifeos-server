/* =====================================================================
   The Sunday check-in for a weekly plan (decisions log #1, canvas board
   P1·E). Next week changes by fixed rules, never by AI:
     - under half of last week's sessions done → lighter (shorter sessions)
     - everything done two weeks running → a bit harder (+5 minutes)
     - otherwise → the same
   and from week 2 the capped week-1 days fill out to the full shape
   (unless the week was lighter). Pure, so every rule is tested.
   ===================================================================== */

export interface SessionState {
  key: string // STRENGTH | WALK
  habitId: string
  title: string
  minutes: number
  days: string[] // this week's days
  fullDays: string[] // the plan's full shape
}

export interface WeekResult {
  done: number
  planned: number
}

export type Verdict = "LIGHTER" | "SAME" | "HARDER"

export interface CheckinDecision {
  verdict: Verdict
  fullInARow: number // weeks in a row with everything done, after this one
  sessions: { habitId: string; key: string; title: string; minutes: number; days: string[]; changed: string | null }[]
  message: string
}

export const MIN_SESSION = 15
export const MAX_SESSION = 60
const round5 = (m: number) => Math.round(m / 5) * 5

const dayName: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" }
const daysText = (days: string[]) => days.map((d) => dayName[d] ?? d).join(", ")

export const decideCheckin = (sessions: SessionState[], week: WeekResult, fullInARowBefore: number, nextWeek: number): CheckinDecision => {
  const ratio = week.planned ? week.done / week.planned : 0
  const full = week.planned > 0 && week.done >= week.planned
  const fullInARow = full ? fullInARowBefore + 1 : 0
  const verdict: Verdict = ratio < 0.5 ? "LIGHTER" : full && fullInARow >= 2 ? "HARDER" : "SAME"

  const out = sessions.map((s) => {
    let minutes = s.minutes
    let days = s.days
    const notes: string[] = []
    if (verdict === "LIGHTER") {
      const next = Math.max(MIN_SESSION, round5(s.minutes * 0.75))
      if (next < s.minutes) notes.push(`${next} min instead of ${s.minutes}`)
      minutes = next
    } else if (verdict === "HARDER") {
      const next = Math.min(MAX_SESSION, s.minutes + 5)
      if (next > s.minutes) notes.push(`${next} min, 5 more`)
      minutes = next
    }
    // The week-1 cap ends after week 1, but not on a week that needed to be lighter.
    if (nextWeek >= 2 && verdict !== "LIGHTER" && s.fullDays.length > s.days.length) {
      days = s.fullDays
      notes.push(`now ${daysText(days)}`)
    }
    return { habitId: s.habitId, key: s.key, title: s.title, minutes, days, changed: notes.length ? notes.join(", ") : null }
  })

  const message =
    verdict === "LIGHTER"
      ? "Next week is lighter. Shorter sessions are easier to start, and starting is what counts."
      : verdict === "HARDER"
        ? "Two full weeks. Next week is a little harder."
        : full
          ? "A full week. Same plan next week."
          : "You're doing fine. Same plan next week."
  return { verdict, fullInARow, sessions: out, message }
}

// The weigh-in line: honest and calm, about the trend, never about one day.
export const weightLine = (prev: number | null, now: number | null, unit = "kg"): string | null => {
  if (now == null) return null
  if (prev == null) return `${now} ${unit} logged. Next weigh-in next Sunday.`
  const d = Math.round((now - prev) * 10) / 10
  if (d < 0) return `${now} ${unit}, ${Math.abs(d)} down since last week.`
  if (d > 0) return `${now} ${unit}, ${d} up. One week can be water or salt; the 3-week trend is what counts.`
  return `${now} ${unit}, same as last week. Steady is fine.`
}
