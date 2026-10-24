/* =====================================================================
   Time tracking (doc 18 item 6, ADR 0038), decided by code, no AI.
   "start timer for DSA", "stop timer", "how long has it been?",
   "discard timer", "where did my time go today?". Only what was timed is
   counted: the rest of the day is never called wasted, and nothing is
   shown unless asked.
   ===================================================================== */

export type TimePeriod = "TODAY" | "YESTERDAY" | "WEEK" | "LAST_7" | "MONTH"

export type TimeIntent =
  | { kind: "START"; what: string | null }
  | { kind: "STOP"; minutes: number | null } // minutes = "it was 45 min", otherwise the clock
  | { kind: "STATUS" }
  | { kind: "DISCARD" }
  | { kind: "WHERE"; period: TimePeriod }

// A timer left running this long is almost certainly forgotten: ask, do not guess.
export const FORGOTTEN_AFTER_MIN = 240

const MAX_WORDS = 14
const TIME_UNIT = "(hours?|hrs?|h|minutes?|mins?)\\b"

const toMinutes = (n: string, unit: string): number => Math.round(Number(n) * (/^h/i.test(unit) ? 60 : 1))

const tidy = (s: string): string =>
  s
    .replace(/^(?:for|on|my|the|a|an)\s+/i, "")
    .replace(/^(?:for|on|my|the|a|an)\s+/i, "")
    .replace(/[?.!,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

const START = /^(?:start|begin|run)\s+(?:a\s+|the\s+|my\s+)?timer(?:\s+(?:for|on)\s+(.{2,50}))?$/i
const START_FOR = /^(?:start|begin)\s+(.{2,50}?)\s+timer$/i
const TIMER_FOR = /^timer\s+(?:for\s+|on\s+)?(.{2,50})$/i
const STOP = new RegExp(`^(?:stop|end|finish)\\s+(?:the\\s+|my\\s+)?timer(?:[ ,]+(?:it\\s+was|that\\s+was|it\\s+took)\\s+(?:about\\s+|only\\s+)?(\\d+(?:\\.\\d+)?)\\s*${TIME_UNIT})?$`, "i")
const STATUS = /^(?:how long (?:has it been|have i been (?:at it|on it|going))|what(?:'s| is) (?:my timer|running)|timer status|is my timer running|how(?:'s| is) my timer)$/i
const DISCARD = /^(?:discard|cancel|delete|scrap)\s+(?:the\s+|my\s+)?timer$/i
const WHERE = /^where\s+(?:did|has|have)\s+(?:my\s+)?(?:time|day|today|week)(?:\s+go)?(?:\s+(?:go|went))?(.*)$/i
const WHERE_TIMED = /^(?:what|how much)\s+(?:did\s+i|have\s+i)\s+(?:time[d]?|track(?:ed)?)(.*)$/i
const TIME_REPORT = /^(?:my\s+)?(?:time\s+report|tracked\s+time)(.*)$/i

const period = (rest: string): TimePeriod => {
  if (/\byesterday\b/i.test(rest)) return "YESTERDAY"
  if (/\b(?:last|past) (?:7 days|week)\b/i.test(rest)) return "LAST_7"
  if (/\bthis month\b/i.test(rest)) return "MONTH"
  if (/\bthis week\b|\bmy week\b/i.test(rest)) return "WEEK"
  return "TODAY"
}

export const timeIntent = (text: string): TimeIntent | null => {
  const t = text.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ")
  if (!t || t.split(/\s+/).length > MAX_WORDS) return null

  const stop = t.match(STOP)
  if (stop) return { kind: "STOP", minutes: stop[1] ? toMinutes(stop[1], stop[2]!) : null }
  if (DISCARD.test(t)) return { kind: "DISCARD" }
  if (STATUS.test(t)) return { kind: "STATUS" }

  const start = t.match(START)
  if (start) return { kind: "START", what: start[1] ? tidy(start[1]) : null }
  const startFor = t.match(START_FOR)
  if (startFor) return { kind: "START", what: tidy(startFor[1]!) }
  const timerFor = t.match(TIMER_FOR)
  if (timerFor && !/^(?:status|is running)/i.test(timerFor[1]!)) return { kind: "START", what: tidy(timerFor[1]!) }

  const where = t.match(WHERE) ?? t.match(WHERE_TIMED) ?? t.match(TIME_REPORT)
  if (where) {
    // "where did my day go" needs go/went somewhere in it, or the other forms above.
    if (WHERE.test(t) && !/\bgo\b|\bwent\b/i.test(t)) return null
    return { kind: "WHERE", period: period(t) }
  }
  return null
}

// ---- reading the running timer ---------------------------------------------------------

export const elapsedMinutes = (startedAt: Date, now: Date): number => Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 60_000))

export const isForgotten = (minutes: number): boolean => minutes > FORGOTTEN_AFTER_MIN

// ---- adding up -------------------------------------------------------------------------

export interface TimedRow {
  label: string
  minutes: number
}

export const duration = (minutes: number): string => {
  const m = Math.round(minutes)
  if (m < 1) return "under a minute"
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export const periodWords = (p: TimePeriod): string =>
  ({ TODAY: "today", YESTERDAY: "yesterday", WEEK: "this week", LAST_7: "in the last 7 days", MONTH: "this month" })[p]

// Same label (any case) adds up; biggest first.
export const byLabel = (rows: TimedRow[]): TimedRow[] => {
  const sum = new Map<string, { label: string; minutes: number }>()
  for (const r of rows) {
    const key = r.label.trim().toLowerCase()
    const cur = sum.get(key)
    if (cur) cur.minutes += r.minutes
    else sum.set(key, { label: r.label.trim(), minutes: r.minutes })
  }
  return [...sum.values()].sort((a, b) => b.minutes - a.minutes)
}

export const whereTimeWent = (rows: TimedRow[], p: TimePeriod, runningLabel: string | null): string => {
  const items = byLabel(rows)
  const total = items.reduce((s, r) => s + r.minutes, 0)
  if (items.length === 0) {
    return runningLabel
      ? `Nothing finished ${periodWords(p)} yet, and your ${runningLabel} timer is still running.`
      : `Nothing was timed ${periodWords(p)}. Say "start timer for DSA" next time and I'll keep track.`
  }
  const shown = items.slice(0, 8).map((r) => `${cap(r.label)} ${duration(r.minutes)}`)
  const more = items.length > 8 ? ` and ${items.length - 8} more` : ""
  const running = runningLabel ? ` Your ${runningLabel} timer is still running.` : ""
  return `${cap(periodWords(p))}: ${shown.join(", ")}${more}. ${duration(total)} timed in all.${running}`
}

export const startedReply = (what: string, stoppedPrev: { label: string; minutes: number } | null): string => {
  const prev = stoppedPrev ? `Stopped ${stoppedPrev.label} at ${duration(stoppedPrev.minutes)}. ` : ""
  return `${prev}Timer started for ${what}. Say "stop timer" when you're done.`
}

export const stoppedReply = (what: string, minutes: number, extra: string | null): string =>
  `Stopped ${what}: ${duration(minutes)}.${extra ? ` ${extra}` : ""}`

export const forgottenReply = (what: string, minutes: number): string =>
  `Your ${what} timer has been running ${duration(minutes)}, which looks like a forgotten stop. I won't guess. Tell me how long it really was ("stop timer, it was 45 min") or say "discard timer".`
