/* =====================================================================
   The restart system (decisions log #14). Coming back is always light:
   no backlog, never bigger than before, and it learns from what got in
   the way last time (the reasons saved with "Not now"). Pure; tested.

     2–6 days   smallest versions, no comment     (now.rules already does this)
     7–13 days  a light week is offered
     14+ days   welcome back, clean slate, the last reasons used
     90+ days   a lot may have changed: offer a quick re-setup
   ===================================================================== */

export type RestartLevel = "NONE" | "SHORT" | "WEEK" | "LONG" | "VERY_LONG"

export const restartLevel = (gapDays: number): RestartLevel =>
  gapDays >= 90 ? "VERY_LONG" : gapDays >= 14 ? "LONG" : gapDays >= 7 ? "WEEK" : gapDays >= 2 ? "SHORT" : "NONE"

export interface SkipSeen {
  reason: string | null // "tired · tomorrow", "no time", "not now"
  hour: number // local hour it was said
}

export interface ReasonInsight {
  reason: string
  count: number
  line: string
  // When a time of day kept failing, the other one to try.
  suggestBlock: "MORNING" | "EVENING" | null
}

const KNOWN = ["tired", "no time", "too big", "not clear what to do", "forgot", "didn't feel like it"] as const
export const MIN_TIMES = 3 // fewer than this is noise, not a pattern

// The person's own words come first in the saved reason ("tired · tomorrow").
const said = (r: string | null): string | null => {
  const head = (r ?? "").split("·")[0]!.trim().toLowerCase()
  return (KNOWN as readonly string[]).includes(head) ? head : null
}

export const reasonInsight = (skips: SkipSeen[]): ReasonInsight | null => {
  const counts = new Map<string, { n: number; evening: number; morning: number }>()
  for (const s of skips) {
    const r = said(s.reason)
    if (!r) continue
    const c = counts.get(r) ?? { n: 0, evening: 0, morning: 0 }
    c.n++
    if (s.hour >= 17) c.evening++
    else if (s.hour < 12) c.morning++
    counts.set(r, c)
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0]
  if (!top || top[1].n < MIN_TIMES) return null
  const [reason, c] = top
  const mostlyEvening = c.evening >= c.n * 0.6
  const mostlyMorning = c.morning >= c.n * 0.6
  const n = c.n
  if (reason === "tired" && mostlyEvening)
    return { reason, count: n, suggestBlock: "MORNING", line: `Last time, evenings kept failing: you said "tired" ${n} times, mostly after work. Try mornings this time?` }
  if (reason === "tired" && mostlyMorning)
    return { reason, count: n, suggestBlock: "EVENING", line: `Last time, mornings were hard: "tired" ${n} times, mostly early. Try evenings this time?` }
  const line = {
    tired: `You were tired ${n} times last time. This week starts with the smallest versions.`,
    "no time": `Time was short ${n} times last time. This week asks for less.`,
    "too big": `Things felt too big ${n} times. Everything starts at the small size now.`,
    "not clear what to do": `Not knowing where to start stopped you ${n} times. Each card shows the first step now.`,
    forgot: `Forgetting got in the way ${n} times. Worth checking your reminders work: My life → Reminders.`,
    "didn't feel like it": `Motivation dipped ${n} times. This week, 5-minute starts are enough.`,
  }[reason]!
  return { reason, count: n, suggestBlock: null, line }
}

// "Your record stays": honest totals, never a broken streak.
export const recordLine = (done: number, workouts: number): string | null => {
  if (done <= 0 && workouts <= 0) return null
  const parts = [workouts > 0 ? `${workouts} workout${workouts === 1 ? "" : "s"}` : null, done > 0 ? `${done} thing${done === 1 ? "" : "s"} done` : null].filter(Boolean)
  return `Your record stays: ${parts.join(" and ")} so far. Nothing was lost.`
}

// A light week: about half, never under 10 minutes. Never bigger than before.
export const lightMinutes = (minutes: number): number => Math.min(minutes, Math.max(10, Math.round((minutes * 0.5) / 5) * 5))
