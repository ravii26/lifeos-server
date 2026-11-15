// The Week tab: what each day held per area, routines as seven dots, and a
// monthly look back. Counts, never scores; nothing is called missed. Pure rules.

const DAY = 86_400_000
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

// The seven days from Monday.
export const weekKeys = (weekStart: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

// ---- minutes per area per day ----

// One thing worked on can be both timed and ticked; it counts once, whichever
// record says more (as on the area page).
export class DayTally {
  private timed = new Map<string, number>()
  private logged = new Map<string, number>()

  add(areaId: string, dayKey: string, item: string, minutes: number, kind: "timed" | "logged") {
    const k = `${areaId}|${dayKey}|${item}`
    const m = kind === "timed" ? this.timed : this.logged
    m.set(k, (m.get(k) ?? 0) + Math.max(0, minutes))
  }

  // areaId → dayKey → minutes
  byAreaAndDay(): Map<string, Map<string, number>> {
    const out = new Map<string, Map<string, number>>()
    for (const k of new Set([...this.timed.keys(), ...this.logged.keys()])) {
      const [areaId, dayKey] = k.split("|") as [string, string]
      const v = Math.max(this.timed.get(k) ?? 0, this.logged.get(k) ?? 0)
      if (!out.has(areaId)) out.set(areaId, new Map())
      const days = out.get(areaId)!
      days.set(dayKey, (days.get(dayKey) ?? 0) + v)
    }
    return out
  }
}

// ---- routines as seven dots ----

export type Dot = "DONE" | "PLANNED" | "PAST" | "OFF"

export interface RoutineIn {
  frequency: string // DAILY | WEEKLY | CUSTOM
  specificDays: string[]
  weeklyTarget: number | null
}

const scheduledOn = (h: RoutineIn, key: string) => {
  if (h.frequency === "WEEKLY") return false // any day of the week will do
  if (h.frequency !== "CUSTOM") return true
  return h.specificDays.includes(CODES[new Date(`${key}T00:00:00Z`).getUTCDay()]!)
}

// Done days are filled; days it was meant for are open circles (PAST once
// gone, PLANNED ahead); other days are off. Nothing is red or called missed.
export const routineDots = (h: RoutineIn, doneKeys: Set<string>, keys: string[], todayKey: string): Dot[] =>
  keys.map((k) => (doneKeys.has(k) ? "DONE" : !scheduledOn(h, k) ? "OFF" : k < todayKey ? "PAST" : "PLANNED"))

// "3 of 4 this week", or "Done 5 times this week".
export const routineLine = (h: RoutineIn, dots: Dot[]): string => {
  const done = dots.filter((d) => d === "DONE").length
  const planned = h.frequency === "WEEKLY" ? h.weeklyTarget ?? 1 : dots.filter((d) => d !== "OFF").length
  if (planned > 0) return `${done} of ${planned} this week`
  return done === 1 ? "Once this week" : `${done} times this week`
}

// ---- looking back, once a month ----

// In the first week of a month, the month before is worth a look.
export const lookBackMonth = (todayKey: string): { month: string; from: string; to: string } | null => {
  const d = new Date(`${todayKey}T00:00:00Z`)
  if (d.getUTCDate() > 7) return null
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))
  return { month: MONTHS[start.getUTCMonth()]!, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

// "16 – 22 Nov"
export const weekLabel = (weekStart: string): string => {
  const a = new Date(`${weekStart}T00:00:00Z`)
  const b = new Date(`${addDays(weekStart, 6)}T00:00:00Z`)
  const m = (d: Date) => MONTHS[d.getUTCMonth()]!.slice(0, 3)
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()} – ${b.getUTCDate()} ${m(b)}`
    : `${a.getUTCDate()} ${m(a)} – ${b.getUTCDate()} ${m(b)}`
}
