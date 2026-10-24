/* =====================================================================
   Capture rules that must not depend on the model (ADR 0004): repeat
   rules, "when is the next one", and the confidence tier for completing
   a to-do. The AI proposes; this code decides what is clear enough to do.
   ===================================================================== */
import { dayKeyInTz, localDayStartMs } from "../../shared/utils/time.util.js"

const LOCAL_DT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/

// "2026-10-05T19:00" in the user's zone → a UTC instant.
export const localToUtc = (local: string, timeZone: string): Date | null => {
  const m = local.match(LOCAL_DT)
  if (!m) return null
  const [, key, hh, mm] = m
  const ms = localDayStartMs(key!, timeZone) + (Number(hh) * 60 + Number(mm)) * 60_000
  return Number.isFinite(ms) ? new Date(ms) : null
}

// ---- repeat rules ---------------------------------------------------

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const
type Day = (typeof DAYS)[number]
const DAY_ALIASES: Record<string, Day> = {
  SU: "SU", SUN: "SU", SUNDAY: "SU", MO: "MO", MON: "MO", MONDAY: "MO", TU: "TU", TUE: "TU", TUESDAY: "TU",
  WE: "WE", WED: "WE", WEDNESDAY: "WE", TH: "TH", THU: "TH", THURSDAY: "TH", FR: "FR", FRI: "FR", FRIDAY: "FR",
  SA: "SA", SAT: "SA", SATURDAY: "SA",
}

export interface RepeatInput {
  freq?: unknown
  days?: unknown
  // Several times a day: explicit clock times, or "every N hours from A to B".
  times?: unknown
  everyHours?: unknown
  from?: unknown
  to?: unknown
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/
const toMinutes = (v: unknown): number | null => {
  const m = typeof v === "string" ? v.trim().match(HHMM) : null
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const fmtMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`

// "every 2 hours from 9 to 21" → 09:00, 11:00, … 21:00. The list is worked out
// here, not by the model, so it is always complete and in order.
const timesOf = (r: RepeatInput): string[] => {
  const every = Number(r.everyHours)
  const from = toMinutes(r.from)
  const to = toMinutes(r.to)
  let list: number[] = []
  if (Number.isFinite(every) && every >= 1 && every <= 12 && from !== null && to !== null && to > from) {
    for (let m = from; m <= to; m += every * 60) list.push(m)
  } else if (Array.isArray(r.times)) {
    list = r.times.map(toMinutes).filter((m): m is number => m !== null)
  }
  return [...new Set(list)].sort((a, b) => a - b).slice(0, 24).map(fmtMinutes)
}

// The model says {freq:"WEEKLY", days:["Sunday"]}; we store an RRULE string.
// Several times a day adds our own TIMES part: "FREQ=DAILY;TIMES=09:00,11:00".
export const repeatToRule = (r: RepeatInput | null | undefined): string | null => {
  if (!r || typeof r !== "object") return null
  const freq = String(r.freq ?? "").toUpperCase()
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") return null
  const days = Array.isArray(r.days)
    ? [...new Set(r.days.map((d) => DAY_ALIASES[String(d).toUpperCase()]).filter((d): d is Day => !!d))]
    : []
  const times = freq === "MONTHLY" ? [] : timesOf(r)
  const timesPart = times.length > 1 ? `;TIMES=${times.join(",")}` : ""
  if (freq === "WEEKLY" && days.length) return `FREQ=WEEKLY;BYDAY=${days.join(",")}${timesPart}`
  return `FREQ=${freq}${timesPart}`
}

const addDaysToKey = (key: string, n: number): string => {
  const d = new Date(`${key}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const weekdayOfKey = (key: string): Day => DAYS[new Date(`${key}T00:00:00.000Z`).getUTCDay()]!

// The next occurrence after `at`, at the same local clock time.
export const nextOccurrence = (rule: string, at: Date, timeZone: string): Date | null => {
  const parts = Object.fromEntries(rule.split(";").map((p) => p.split("=") as [string, string]))
  const freq = parts.FREQ
  const key = dayKeyInTz(at, timeZone)
  const minutesIntoDay = Math.round((at.getTime() - localDayStartMs(key, timeZone)) / 60_000)
  const times = (parts.TIMES ?? "").split(",").map(toMinutes).filter((m): m is number => m !== null).sort((a, b) => a - b)
  if (times.length && (freq === "DAILY" || freq === "WEEKLY")) {
    const wanted = (parts.BYDAY ?? "").split(",").filter(Boolean)
    const dayOk = (k: string) => freq === "DAILY" || !wanted.length || wanted.includes(weekdayOfKey(k))
    // Later today first, then the first time on the next day that counts.
    const later = dayOk(key) ? times.find((m) => m > minutesIntoDay) : undefined
    if (later !== undefined) return new Date(localDayStartMs(key, timeZone) + later * 60_000)
    for (let n = 1; n <= 8; n++) {
      const k = addDaysToKey(key, n)
      if (dayOk(k)) return new Date(localDayStartMs(k, timeZone) + times[0]! * 60_000)
    }
    return null
  }
  let nextKey: string | null = null
  if (freq === "DAILY") {
    nextKey = addDaysToKey(key, 1)
  } else if (freq === "WEEKLY") {
    const wanted = (parts.BYDAY ?? "").split(",").filter(Boolean)
    if (!wanted.length) nextKey = addDaysToKey(key, 7)
    else for (let n = 1; n <= 7 && !nextKey; n++) if (wanted.includes(weekdayOfKey(addDaysToKey(key, n)))) nextKey = addDaysToKey(key, n)
  } else if (freq === "MONTHLY") {
    const [y, m, d] = key.split("-").map(Number) as [number, number, number]
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate() // days in the next month
    nextKey = new Date(Date.UTC(y, m, Math.min(d, lastDay))).toISOString().slice(0, 10)
  } else if (freq === "YEARLY") {
    // Birthdays: the same day next year (29 February falls back to the last day of February).
    const [y, m, d] = key.split("-").map(Number) as [number, number, number]
    const lastDay = new Date(Date.UTC(y + 1, m, 0)).getUTCDate()
    nextKey = new Date(Date.UTC(y + 1, m - 1, Math.min(d, lastDay))).toISOString().slice(0, 10)
  }
  if (!nextKey) return null
  return new Date(localDayStartMs(nextKey, timeZone) + minutesIntoDay * 60_000)
}

// The next `count` times a repeating reminder fires, starting from the first
// one that is not yet past. A reminder that was missed (never ticked) still
// rolls forward, so ignoring one never stops the next.
export const upcomingOccurrences = (rule: string, at: Date, timeZone: string, now: Date, count = 7): Date[] => {
  let cur: Date | null = at
  for (let guard = 0; cur && cur.getTime() < now.getTime() - 60_000 && guard < 5000; guard++) cur = nextOccurrence(rule, cur, timeZone)
  const out: Date[] = []
  while (cur && out.length < count) {
    out.push(cur)
    cur = nextOccurrence(rule, cur, timeZone)
  }
  return out
}

// ---- confidence tier: which to-do did they mean? --------------------

const STOP = new Set(
  ("done with the a an my i me to for of it and is was just finished finish completed complete did do have has " +
    "task todo to-do that this one ok okay now already kar liya diya ho gaya gayi hogaya ka ki ke ko").split(" "),
)

// Light stemming so "updated" matches "update" without a language library.
const stem = (w: string) => w.replace(/(ing|ed|es|s|d)$/, "")

const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)

export interface OpenTask {
  id: string
  title: string
}

// "Done with the report" with two open reports must ask, not guess. A task
// counts as the clear match only when the message covers its whole title and
// no other task does.
export const matchingTasks = (message: string, tasks: OpenTask[]): OpenTask[] => {
  const said = new Set(tokens(message))
  const scored = tasks
    .map((t) => {
      const words = tokens(t.title)
      const shared = words.filter((w) => said.has(w)).length
      return { t, shared, score: words.length ? shared / words.length : 0 }
    })
    .filter((x) => x.shared > 0)
  const whole = scored.filter((x) => x.score === 1)
  if (whole.length === 1) return [whole[0]!.t]
  return scored.sort((a, b) => b.score - a.score).map((x) => x.t)
}

export const isAmbiguousCompletion = (message: string, tasks: OpenTask[], chosenId: string): OpenTask[] | null => {
  const matches = matchingTasks(message, tasks)
  return matches.length > 1 && matches.some((m) => m.id === chosenId) ? matches.slice(0, 4) : null
}
