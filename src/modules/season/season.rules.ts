/* =====================================================================
   Seasons (build plan Phase 1, decisions log #7): a chapter of life with
   at most 2 focus areas and at most 3 kept going in small doses. Parked
   areas wait with a date and come back on their own. Pure functions, so
   the caps and the week maths are unit-tested.

   Where an area sits is its existing tier:
     MAIN      → Focus (max 2): gets the real time and the Now card
     SECONDARY → Keep going (max 3): smallest versions only
     MAINTAIN  → In the background: only when there is room
     LATER     → Parked: never shown until laterUntil passes
   ===================================================================== */
import { effectiveTier } from "../guide/guide.rules.js"

export type Tier = "MAIN" | "SECONDARY" | "MAINTAIN" | "LATER"

export const CAPS = { MAIN: 2, SECONDARY: 3 } as const
export const DEFAULT_WEEKS = 10
const WEEK = 7 * 86_400_000

export interface AreaLite {
  id: string
  name: string
  tier: Tier
  laterUntil: Date | null
  order: number
}

export interface Places {
  focus: { id: string; name: string }[]
  keepGoing: { id: string; name: string }[]
  background: { id: string; name: string }[]
  parked: { id: string; name: string; until: Date | null }[]
}

// A parked area whose date has passed is shown where it now acts: in the background.
export const placesOf = (areas: AreaLite[], now: Date): Places => {
  const sorted = [...areas].sort((a, b) => a.order - b.order)
  const at = (t: Tier) => sorted.filter((a) => effectiveTier(a.tier, a.laterUntil, now) === t)
  const short = (a: AreaLite) => ({ id: a.id, name: a.name })
  return {
    focus: at("MAIN").map(short),
    keepGoing: at("SECONDARY").map(short),
    background: at("MAINTAIN").map(short),
    parked: at("LATER").map((a) => ({ ...short(a), until: a.laterUntil })),
  }
}

export type TierCheck = { ok: true } | { ok: false; full: "MAIN" | "SECONDARY"; current: { id: string; name: string }[] }

// Moving an area into Focus or Keep going when that place is full is never
// done silently: the person picks what makes room (decisions log #7).
// `swapOutId` is the area they chose to move out.
export const checkPlaceChange = (areas: AreaLite[], areaId: string, tier: Tier, now: Date, swapOutId?: string): TierCheck => {
  if (tier !== "MAIN" && tier !== "SECONDARY") return { ok: true }
  const others = areas.filter((a) => a.id !== areaId && a.id !== swapOutId && effectiveTier(a.tier, a.laterUntil, now) === tier)
  if (others.length < CAPS[tier]) return { ok: true }
  return { ok: false, full: tier, current: others.map((a) => ({ id: a.id, name: a.name })) }
}

export interface SeasonPick {
  focusIds: string[]
  keepGoingIds: string[]
  parked: { areaId: string; until?: Date | null }[]
}

// Checks a whole season set at once (setup and the season review).
export const validatePick = (p: SeasonPick): string | null => {
  const ids = [...p.focusIds, ...p.keepGoingIds, ...p.parked.map((x) => x.areaId)]
  if (p.focusIds.length > CAPS.MAIN) return `At most ${CAPS.MAIN} areas can be in focus.`
  if (p.keepGoingIds.length > CAPS.SECONDARY) return `At most ${CAPS.SECONDARY} areas can be kept going.`
  if (new Set(ids).size !== ids.length) return "Each area can only be in one place."
  return null
}

// The tier every area gets when a season starts. Areas not named keep LATER
// if already parked, and otherwise move to the background, so an old focus
// never quietly stays in focus next to the new two.
export const tiersForPick = (areas: AreaLite[], p: SeasonPick): Map<string, { tier: Tier; laterUntil: Date | null }> => {
  const out = new Map<string, { tier: Tier; laterUntil: Date | null }>()
  const parked = new Map(p.parked.map((x) => [x.areaId, x.until ?? null]))
  for (const a of areas) {
    if (p.focusIds.includes(a.id)) out.set(a.id, { tier: "MAIN", laterUntil: null })
    else if (p.keepGoingIds.includes(a.id)) out.set(a.id, { tier: "SECONDARY", laterUntil: null })
    else if (parked.has(a.id)) out.set(a.id, { tier: "LATER", laterUntil: parked.get(a.id) ?? null })
    else if (a.tier === "LATER") out.set(a.id, { tier: "LATER", laterUntil: a.laterUntil })
    else out.set(a.id, { tier: "MAINTAIN", laterUntil: null })
  }
  return out
}

// Week 1 is the first 7 days. Never below 1.
export const seasonWeek = (startedAt: Date, now: Date): number => Math.max(1, Math.floor((now.getTime() - startedAt.getTime()) / WEEK) + 1)

export const seasonWeeks = (startedAt: Date, endsAt: Date | null): number =>
  endsAt ? Math.max(1, Math.ceil((endsAt.getTime() - startedAt.getTime()) / WEEK)) : DEFAULT_WEEKS

export const defaultEnd = (startedAt: Date): Date => new Date(startedAt.getTime() + DEFAULT_WEEKS * WEEK)

// The date half of "event or date, whichever comes first". The event half is
// the person saying it happened ("I got the job"), handled where it is said.
export const seasonOver = (endsAt: Date | null, now: Date): boolean => !!endsAt && now.getTime() >= endsAt.getTime()

// "Switch & Shape · week 2 of 10": the small line under the greeting on Now.
export const seasonLine = (name: string | null, number: number, week: number, weeks: number): string =>
  `${name?.trim() || `Season ${number}`} · week ${Math.min(week, weeks)} of ${weeks}`

/* ---------------------------------------------------------------------
   Season-end review (canvas board P1·F). Honest totals, parked areas back
   as options, and a pre-filled next season the person only confirms.
   --------------------------------------------------------------------- */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// The top lines of the review. Plain counts, no score, no guilt: a quiet
// season is said plainly and the next one starts smaller.
export const reviewLines = (t: { done: number; dropped: number; weight: { from: number; to: number; unit: string } | null }): string[] => {
  const out: string[] = []
  if (t.done > 0) out.push(`${plural(t.done, "thing")} done this season.`)
  else out.push("A quiet season. That happens. The next one can start smaller.")
  if (t.dropped > 0) out.push(`${plural(t.dropped, "thing")} dropped on purpose. That counts too.`)
  if (t.weight) {
    const diff = Math.round((t.weight.to - t.weight.from) * 10) / 10
    const fmt = (v: number) => `${Math.round(v * 10) / 10} ${t.weight!.unit}`.trim()
    if (diff < 0) out.push(`Weight ${fmt(t.weight.from)} → ${fmt(t.weight.to)}: ${Math.abs(diff)} down.`)
    else if (diff === 0) out.push(`Weight steady at ${fmt(t.weight.to)}.`)
    else out.push(`Weight ${fmt(t.weight.from)} → ${fmt(t.weight.to)}. The next season can change the plan.`)
  }
  return out
}

// Why a parked area might be worth bringing back: what is waiting in it.
export const parkedWhy = (waiting: number): string => (waiting > 0 ? `${plural(waiting, "thing")} waiting` : "Nothing saved yet")

// The next season, pre-filled (decisions log #7 + board P1·F): a focus with a
// plan still running continues where it is; any other old focus moves to Keep
// going; old Keep going fills what is left, up to 3. The second focus slot is
// left for the person, so a parked area can come back.
export const nextSeasonPick = (places: Places, planAreaIds: Set<string>): { focusIds: string[]; keepGoingIds: string[] } => {
  const focusIds = places.focus.filter((a) => planAreaIds.has(a.id)).map((a) => a.id).slice(0, CAPS.MAIN)
  const keepGoingIds = [...places.focus.filter((a) => !planAreaIds.has(a.id)), ...places.keepGoing].map((a) => a.id).slice(0, CAPS.SECONDARY)
  return { focusIds, keepGoingIds }
}

// "Carry it on": a few more weeks from the later of today and the old end.
export const extendedEnd = (endsAt: Date | null, now: Date, weeks: number): Date =>
  new Date(Math.max(endsAt?.getTime() ?? 0, now.getTime()) + weeks * WEEK)
