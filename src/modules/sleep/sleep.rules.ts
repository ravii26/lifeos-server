/* =====================================================================
   The sleep fix (decisions log #13, agreed 12 Nov 2026): sleep is fixed,
   not planned around. One fast jump in week 1 (wake at most an hour after
   the target), then 30 minutes earlier each week until the target. Wake
   time is the anchor; bedtime is wake minus the hours wanted. The ladder
   only moves on when the wake time was kept on 5 of 7 days. General
   guidance, not medical. Pure functions, unit-tested.
   ===================================================================== */
import { toMin, type DayBlock } from "../now/now.rules.js"

export interface SleepStep {
  week: number
  wake: string // "HH:MM"
  sleep: string // "HH:MM", "24:00" = midnight
}

export const GUIDELINE_MINUTES = 7 * 60 // adults: at least 7 hours
export const MIN_HOURS = 5 * 60
export const MAX_HOURS = 10 * 60
const FAST_JUMP_LIMIT = 60 // week 1 wakes at most this long after the target
const STEP = 30 // then this much earlier each week
export const KEEP_TO_ADVANCE = 5 // days of 7 the wake time must be kept

const DAY = 24 * 60
const hhmm = (min: number) => {
  const m = ((min % DAY) + DAY) % DAY
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}
// Bedtime as the day schedule writes it: midnight is "24:00", the night before the wake.
const bedtime = (wakeMin: number, hours: number) => {
  const b = wakeMin - hours
  return b <= 0 ? (b === 0 ? "24:00" : hhmm(b)) : hhmm(b)
}

// The whole ladder from where they are to the target.
export const ladder = (fromWake: string, targetWake: string, hours: number): SleepStep[] => {
  const target = toMin(targetWake)
  const from = toMin(fromWake)
  // Week 1: the fast jump. Never later than now, never more than an hour after the target.
  const first = Math.max(target, Math.min(from, target + FAST_JUMP_LIMIT))
  const steps: SleepStep[] = []
  for (let w = first, week = 1; ; w -= STEP, week++) {
    const wake = Math.max(w, target)
    steps.push({ week, wake: hhmm(wake), sleep: bedtime(wake, hours) })
    if (wake === target) break
  }
  return steps
}

// Sunday: kept the wake time on [daysOnTime] of 7 → move on, or stay (no penalty).
export const nextStep = (step: number, total: number, daysOnTime: number): { step: number; moved: boolean; done: boolean } => {
  if (daysOnTime >= KEEP_TO_ADVANCE && step < total) return { step: step + 1, moved: true, done: step + 1 === total }
  return { step, moved: false, done: step === total }
}

// Writes a step into one day: the first block starts at the wake time and
// the last block ends at bedtime. Blocks pushed out entirely are dropped;
// office and other fixed blocks in between are untouched.
export const retimeDay = (blocks: DayBlock[], wake: string, sleep: string): DayBlock[] => {
  if (!blocks.length) return blocks
  const w = toMin(wake)
  const s = sleep === "24:00" ? DAY : toMin(sleep)
  // A bedtime after midnight can't be written into today's day; it ends the day at midnight.
  const end = s <= w ? DAY : s
  const out = blocks
    .map((b) => ({ ...b, startMin: toMin(b.start), endMin: b.end === "24:00" ? DAY : toMin(b.end) }))
    .filter((b) => b.endMin > w && b.startMin < end)
  if (!out.length) return blocks
  out[0]!.startMin = Math.min(Math.max(out[0]!.startMin, w), w)
  out[out.length - 1]!.endMin = end
  return out.map(({ startMin, endMin, ...b }) => ({ ...b, start: hhmm(startMin), end: endMin === DAY ? "24:00" : hhmm(endMin) }))
}

// Said once, when someone picks under the guideline. Their choice stands.
export const guidelineNote = (hours: number): string | null =>
  hours < GUIDELINE_MINUTES ? "Most adults need at least 7 hours, and less makes focus and fat loss harder. Your choice stands; I'll only mention it again if your low days follow short nights." : null
