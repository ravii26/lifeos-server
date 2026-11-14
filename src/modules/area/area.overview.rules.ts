// Where every area stands this week. Pure rules: no database, no clock, no AI.
//
// A mode is how much of the person an area gets right now. All areas stay
// alive; nothing is capped. The mode is stored in the existing `tier` column,
// so no data moves: MAIN = Push, SECONDARY = Explore, MAINTAIN = Maintain,
// LATER = Rest.

import { dateFromKey, daysBetweenKeys, utcDayKey, addUtcDays } from "../../shared/utils/time.util.js"

export type AreaMode = "PUSH" | "MAINTAIN" | "EXPLORE" | "REST"
export type AreaTierName = "MAIN" | "SECONDARY" | "MAINTAIN" | "LATER"

const MODE_OF_TIER: Record<AreaTierName, AreaMode> = { MAIN: "PUSH", SECONDARY: "EXPLORE", MAINTAIN: "MAINTAIN", LATER: "REST" }
const TIER_OF_MODE: Record<AreaMode, AreaTierName> = { PUSH: "MAIN", EXPLORE: "SECONDARY", MAINTAIN: "MAINTAIN", REST: "LATER" }

export const modeOfTier = (tier: string): AreaMode => MODE_OF_TIER[tier as AreaTierName] ?? "MAINTAIN"
export const tierOfMode = (mode: AreaMode): AreaTierName => TIER_OF_MODE[mode]

// With no time plan, progress is days with something done against this many.
const TARGET_DAYS: Record<AreaMode, number> = { PUSH: 4, MAINTAIN: 2, EXPLORE: 1, REST: 0 }

// The Monday that starts the week containing `todayKey`.
export const weekStartKey = (todayKey: string): string => {
  const d = dateFromKey(todayKey)
  const sinceMonday = (d.getUTCDay() + 6) % 7
  return utcDayKey(addUtcDays(d, -sinceMonday))
}

// 130 → "2h 10", 45 → "45 min", 120 → "2h".
export const span = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${String(rest).padStart(2, "0")}`
}

// One thing worked on can be both timed and ticked. Count it once: whichever
// record says more.
export const itemMinutes = (timed: number, logged: number): number => Math.max(timed, logged)

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export interface AreaWeek {
  mode: AreaMode
  weeklyMinutes: number | null // what the person set for this area
  projectMinutes: number // weekly targets of the area's active goals
  minutes: number // done this week
  activeDays: number // days this week with something done
  lastKey: string | null // last day anything was done (may be before this week)
  todayKey: string
  restUntilKey: string | null
}

export interface AreaStanding {
  plannedMinutes: number
  value: number // 0..1, the length of the spoke on the life wheel
  status: string
}

export const standing = (w: AreaWeek): AreaStanding => {
  if (w.mode === "REST") {
    const until = w.restUntilKey && w.restUntilKey > w.todayKey ? dateFromKey(w.restUntilKey) : null
    return { plannedMinutes: 0, value: 0, status: until ? `Resting until ${until.getUTCDate()} ${MONTHS[until.getUTCMonth()]}` : "Resting" }
  }
  const planned = w.weeklyMinutes ?? w.projectMinutes
  if (planned > 0) {
    return { plannedMinutes: planned, value: Math.min(1, w.minutes / planned), status: `${span(w.minutes)} of ${span(planned)} this week` }
  }
  const value = Math.min(1, w.activeDays / TARGET_DAYS[w.mode])
  if (w.activeDays > 0) return { plannedMinutes: 0, value, status: `Active ${w.activeDays} ${w.activeDays === 1 ? "day" : "days"} this week` }
  if (!w.lastKey) return { plannedMinutes: 0, value: 0, status: "Not started yet" }
  const ago = daysBetweenKeys(w.lastKey, w.todayKey)
  return { plannedMinutes: 0, value: 0, status: ago <= 1 ? "Last touched yesterday" : `Last touched ${ago} days ago` }
}

export interface Capacity {
  neededMinutes: number
  freeMinutes: number
  over: boolean
  // A suggestion, never a block. Null when the week fits or there is nothing to compare.
  note: string | null
}

// What the week asks for against the free time in it.
export const capacity = (planned: { mode: AreaMode; plannedMinutes: number }[], freeMinutes: number): Capacity => {
  const needed = planned.filter((p) => p.mode !== "REST").reduce((s, p) => s + p.plannedMinutes, 0)
  const over = freeMinutes > 0 && needed > freeMinutes
  return {
    neededMinutes: needed,
    freeMinutes,
    over,
    note: over ? `This week asks for ${span(needed)} and you have about ${span(freeMinutes)} free. Moving one area to Maintain would make it fit.` : null,
  }
}
