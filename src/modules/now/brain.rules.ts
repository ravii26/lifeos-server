/* =====================================================================
   The brain (plan 16 §1): pure rules, no DB, no AI.
   - Weekly targets: how far along this week, and the session to do now.
   - Scoring: deadline pressure, how far behind, tier, balance, fit, and
     what was put off today. Each point of score comes with a reason, so
     "why" is the real reason, not a template.
   - Advice (Layer 4): when the honest answer is "not now" or "there's a
     better way". The person always keeps the last word.
   ===================================================================== */
import type { Tier } from "../guide/guide.rules.js"
import { toMin, type Block, type DayBlock } from "./now.rules.js"

// ---- weekly targets ---------------------------------------------------------

export interface WeeklyTarget {
  projectId: string
  title: string
  unit: "min" | "count"
  countUnit: string | null // "applications"
  target: number // per week
  doneThisWeek: number
  doneToday: number
  daysElapsed: number // whole days of this week before today (Mon = 0 … Sun = 6)
  sessionMinutes: number | null
  block: Block | null
  tier: Tier
  areaName: string | null
  deadlineKey: string | null // the project's or its goal's deadline
  goalTitle: string | null
}

export interface TargetPace {
  expectedByToday: number // what an even pace would have done before today
  behind: number // > 0 = behind an even pace
  remaining: number
  daysLeft: number // including today
  todayShare: number // an even share of what's left, for today
}

export const targetPace = (t: WeeklyTarget): TargetPace => {
  const daysLeft = Math.max(1, 7 - t.daysElapsed)
  const expectedByToday = (t.target * t.daysElapsed) / 7
  const remaining = Math.max(0, t.target - t.doneThisWeek)
  const doneBeforeToday = t.doneThisWeek - t.doneToday
  return {
    expectedByToday,
    behind: expectedByToday - doneBeforeToday,
    remaining,
    daysLeft,
    todayShare: Math.max(0, t.target - doneBeforeToday) / daysLeft,
  }
}

// A session sized for today: what's left spread over the days left, between
// 15 and 60 minutes unless the person said how long a sitting is.
export interface TargetSession {
  minutes: number
  count: number | null // "apply to 2 jobs"
  title: string
}

const plural = (n: number, unit: string) => (n === 1 ? unit.replace(/s$/, "") : unit)

export const targetSession = (t: WeeklyTarget): TargetSession | null => {
  const p = targetPace(t)
  if (p.remaining <= 0) return null
  // Already did today's share: don't nag for more today.
  if (t.doneToday >= Math.max(1, Math.ceil(p.todayShare))) return null
  if (t.unit === "min") {
    const want = Math.ceil(p.todayShare - t.doneToday)
    const minutes = t.sessionMinutes ?? Math.min(60, Math.max(15, Math.round(want / 5) * 5))
    return { minutes, count: null, title: t.title }
  }
  const count = Math.max(1, Math.ceil(p.todayShare - t.doneToday))
  const unit = t.countUnit ?? "times"
  return { minutes: t.sessionMinutes ?? Math.min(60, 10 * count), count, title: `${t.title}: ${count} ${plural(count, unit)}` }
}

export const formatAmount = (n: number, unit: "min" | "count", countUnit: string | null): string => {
  const v = Math.round(n)
  if (unit === "count") return `${v} ${plural(v, countUnit ?? "times")}`
  if (v >= 90) return `${(v / 60).toFixed(1).replace(/\.0$/, "")} h`
  return `${v} min`
}

// ---- scoring ------------------------------------------------------------------

export interface Reason {
  weight: number
  text: string
}

export interface ScoreInput {
  tier: Tier
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  dueKey: string | null // a to-do's own date
  deadlineKey: string | null // the project's or goal's deadline
  goalTitle: string | null
  areaName: string | null
  areaIdleDays: number | null // days since anything in this area was done
  anchorText: string | null // "After my morning coffee" when the habit is anchored here
  blockMatch: boolean // belongs to exactly this part of the day
  minutes: number // how long it takes now
  available: number // free minutes now
  skippedToday: boolean // "Not now" earlier today
  target?: { behind: number; target: number; unit: "min" | "count"; countUnit: string | null }
}

const TIER_POINTS: Record<Tier, number> = { MAIN: 100, SECONDARY: 60, MAINTAIN: 25, LATER: 0 }
const PRIORITY_POINTS = { LOW: 0, MEDIUM: 8, HIGH: 18, CRITICAL: 28 } as const

export const daysUntil = (fromKey: string, toKey: string): number =>
  Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000)

const inWeeks = (days: number) => (days <= 13 ? `${days} day${days === 1 ? "" : "s"}` : `${Math.round(days / 7)} weeks`)

export const scoreItem = (c: ScoreInput, todayKey: string): { score: number; reasons: Reason[] } => {
  const reasons: Reason[] = []
  let score = TIER_POINTS[c.tier] + (c.priority ? PRIORITY_POINTS[c.priority] : 0)

  if (c.dueKey) {
    const d = daysUntil(todayKey, c.dueKey)
    if (d < 0) reasons.push({ weight: 25, text: "It's past its date" })
    else if (d === 0) reasons.push({ weight: 22, text: "It's due today" })
    else if (d === 1) reasons.push({ weight: 16, text: "It's due tomorrow" })
    else if (d <= 3) reasons.push({ weight: 8, text: `It's due in ${d} days` })
  }
  if (c.deadlineKey) {
    const d = daysUntil(todayKey, c.deadlineKey)
    if (d >= 0 && d <= 56) reasons.push({ weight: d <= 14 ? 16 : 10, text: `${c.goalTitle ?? "The deadline"} is in ${inWeeks(d)}` })
  }
  if (c.target && c.target.behind > 0 && c.target.target > 0) {
    const share = Math.min(1, c.target.behind / c.target.target)
    reasons.push({ weight: Math.round(10 + 30 * share), text: `You're ${formatAmount(c.target.behind, c.target.unit, c.target.countUnit)} behind this week` })
  } else if (c.goalTitle) {
    reasons.push({ weight: 8, text: `It moves ${c.goalTitle}` })
  }
  if (c.areaIdleDays !== null && c.areaIdleDays >= 5 && c.areaName) {
    reasons.push({ weight: 8, text: `${c.areaName} hasn't had any time for ${c.areaIdleDays} days` })
  }
  if (c.anchorText) reasons.push({ weight: 12, text: c.anchorText.replace(/\.$/, "") })
  else if (c.blockMatch) reasons.push({ weight: 6, text: "This part of the day is when it fits" })
  // Fills the free time without overflowing it.
  score += Math.max(0, 10 - Math.abs(c.available - c.minutes) / 3)
  // "Not now" earlier today: the plan moves on to everything else first, and
  // only comes back to it when nothing else is left.
  if (c.skippedToday) score -= 200

  score += reasons.reduce((s, r) => s + r.weight, 0)
  reasons.sort((a, b) => b.weight - a.weight)
  return { score, reasons }
}

// The top one or two reasons, as one plain sentence.
export const whyFromReasons = (reasons: Reason[], fallback: string): string => {
  const top = reasons.slice(0, 2).map((r) => r.text)
  if (!top.length) return fallback
  const [a, b] = top
  return b ? `${a}, and ${b[0]!.toLowerCase()}${b.slice(1)}.` : `${a}.`
}

// ---- tight-deadline takeover ------------------------------------------------

export interface DeadlineFocus {
  sourceId: string
  title: string
  minutes: number
  dueKey: string
}

// A to-do due today or tomorrow that needs most of the free time left today
// takes the rest of the day; the plan says what waits.
export const deadlineFocus = (
  items: { sourceId: string; sourceType: string; title: string; minutes: number; dueKey: string | null }[],
  freeToday: number,
  todayKey: string,
): DeadlineFocus | null => {
  if (freeToday <= 0) return null
  const urgent = items
    .filter((i) => i.sourceType === "TASK" && i.dueKey && daysUntil(todayKey, i.dueKey) <= 1 && daysUntil(todayKey, i.dueKey) >= 0)
    .filter((i) => i.minutes >= freeToday * 0.6)
    .sort((a, b) => a.dueKey!.localeCompare(b.dueKey!) || b.minutes - a.minutes)[0]
  return urgent ? { sourceId: urgent.sourceId, title: urgent.title, minutes: urgent.minutes, dueKey: urgent.dueKey! } : null
}

// ---- Layer 4: advice ------------------------------------------------------------

export type AdviceKind = "LATE_NIGHT" | "KEEPS_SLIPPING" | "SAVES_PILING" | "DEADLINE_FOCUS"

export interface AdviceAction {
  label: string
  // MINIMUM_NOW = count the smallest version now (no change to the item).
  choice: "MINIMUM_NOW" | "SMALLER" | "TOMORROW" | "WEEKEND" | "LET_GO" | "OPEN_SAVES" | "ANYWAY"
}

export interface Advice {
  kind: AdviceKind
  message: string
  sourceType?: "TASK" | "HABIT" | "PROJECT"
  sourceId?: string
  actions: AdviceAction[]
}

export const SLIPPING_AFTER = 3

export interface AdviceInput {
  nowMin: number
  blocks: DayBlock[]
  block: Block
  // fullMinutes: how long the thing really takes (Now may already show a smaller version).
  top: { sourceType: "TASK" | "HABIT" | "PROJECT"; sourceId: string; title: string; minutes: number; fullMinutes: number; smaller: boolean } | null
  skips14d: number // times the top item was put off in the last 14 days
  savesToday: number
  savesActedToday: number
}

// One piece of advice at most, the most useful first.
export const adviseNow = (a: AdviceInput): Advice | null => {
  const night = a.blocks.find((b) => b.block === "NIGHT")
  const lateFrom = night ? toMin(night.start) : 22 * 60 + 30
  if (a.top && a.nowMin >= lateFrom && a.top.fullMinutes > 15) {
    return {
      kind: "LATE_NIGHT",
      message: `It's late. ${a.top.title} will go better tomorrow; tonight, sleep is the better move. If you want, just the smallest version.`,
      sourceType: a.top.sourceType,
      sourceId: a.top.sourceId,
      actions: [
        { label: "Just 2 minutes", choice: "MINIMUM_NOW" },
        { label: "Tomorrow", choice: "TOMORROW" },
        { label: "Do it anyway", choice: "ANYWAY" },
      ],
    }
  }
  if (a.top && a.skips14d >= SLIPPING_AFTER) {
    return {
      kind: "KEEPS_SLIPPING",
      message: `${a.top.title} keeps slipping (put off ${a.skips14d} times in two weeks). Make it smaller, move it to the weekend, or let it go?`,
      sourceType: a.top.sourceType,
      sourceId: a.top.sourceId,
      actions: [
        { label: "Make it smaller", choice: "SMALLER" },
        { label: "Weekend", choice: "WEEKEND" },
        { label: "Let it go", choice: "LET_GO" },
      ],
    }
  }
  if (a.savesToday >= 5 && a.savesActedToday === 0) {
    return {
      kind: "SAVES_PILING",
      message: `${a.savesToday} saves today and none turned into a step yet. Pick one to do this week; the rest can wait.`,
      actions: [{ label: "Pick one", choice: "OPEN_SAVES" }],
    }
  }
  return null
}

// ---- interruptions: "meeting till 4" ----------------------------------------------

// The next weekend day (Saturday) on or after tomorrow, as a day key.
export const nextSaturdayKey = (todayKey: string): string => {
  const d = new Date(`${todayKey}T00:00:00Z`)
  const add = ((6 - d.getUTCDay() + 7) % 7) || 7
  d.setUTCDate(d.getUTCDate() + add)
  return d.toISOString().slice(0, 10)
}
