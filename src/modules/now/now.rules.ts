/* =====================================================================
   "The right thing for right now": pure rules (plan §4). No DB, no AI.
   Time of day → day block, mode, minutes available, what fits, what is
   most urgent. The result is a shortlist with sizes; wording is templates
   (ADR 0004: rules decide).
   ===================================================================== */
import { effectiveTier, whyFor, type Tier } from "../guide/guide.rules.js"

export { effectiveTier }

export const BLOCKS = ["MORNING", "COMMUTE", "OFFICE", "GYM", "EVENING", "NIGHT"] as const
export type Block = (typeof BLOCKS)[number]
export type Mode = "NORMAL" | "BUSY" | "SICK" | "TRAVEL" | "HOLIDAY"
export const MODES: Mode[] = ["NORMAL", "BUSY", "SICK", "TRAVEL", "HOLIDAY"]

export interface DayBlock {
  block: Block
  start: string // HH:mm
  end: string // HH:mm, "24:00" allowed
  freeMinutes: number
}

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

const HHMM = /^([01]\d|2[0-4]):[0-5]\d$/

// ---- the day ---------------------------------------------------------

// Used until the person tells Ally their real day.
export const defaultDay = (weekday: number): DayBlock[] =>
  weekday === 0 || weekday === 6
    ? [
        { block: "MORNING", start: "07:00", end: "12:00", freeMinutes: 150 },
        { block: "EVENING", start: "12:00", end: "22:00", freeMinutes: 300 },
        { block: "NIGHT", start: "22:00", end: "24:00", freeMinutes: 30 },
      ]
    : [
        { block: "MORNING", start: "06:00", end: "09:30", freeMinutes: 30 },
        { block: "OFFICE", start: "09:30", end: "19:00", freeMinutes: 0 },
        { block: "EVENING", start: "19:00", end: "22:00", freeMinutes: 90 },
        { block: "NIGHT", start: "22:00", end: "24:00", freeMinutes: 30 },
      ]

// What a block is worth as free time when the person did not say.
const FREE_SHARE: Record<Block, number> = { MORNING: 0.5, COMMUTE: 0, OFFICE: 0, GYM: 0, EVENING: 1, NIGHT: 0.5 }

// Validates blocks from the model or the app, sorts them, drops overlaps, and
// fills the gaps (morning before, evening and night after) so a message like
// "I work 10 to 8:30" gives a whole day.
export const normalizeDay = (input: unknown): DayBlock[] | null => {
  if (!Array.isArray(input)) return null
  const given: DayBlock[] = []
  for (const raw of input) {
    const b = raw as Partial<DayBlock>
    if (!b || !BLOCKS.includes(b.block as Block) || !HHMM.test(String(b.start)) || !HHMM.test(String(b.end))) continue
    const start = toMin(b.start!)
    const end = toMin(b.end!)
    if (end <= start) continue
    const duration = end - start
    const free = Number.isFinite(Number(b.freeMinutes))
      ? Math.max(0, Math.min(duration, Math.round(Number(b.freeMinutes))))
      : Math.round(duration * FREE_SHARE[b.block as Block])
    given.push({ block: b.block as Block, start: b.start!, end: b.end!, freeMinutes: free })
  }
  if (!given.length) return null
  given.sort((a, b) => toMin(a.start) - toMin(b.start))
  const out: DayBlock[] = []
  for (const b of given) if (!out.length || toMin(b.start) >= toMin(out[out.length - 1]!.end)) out.push(b)
  return fillGaps(out)
}

const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`

const fillGaps = (blocks: DayBlock[]): DayBlock[] => {
  const out = [...blocks]
  const first = toMin(out[0]!.start)
  if (first > 6 * 60 && !out.some((b) => b.block === "MORNING")) {
    out.unshift({ block: "MORNING", start: "06:00", end: fmt(first), freeMinutes: Math.round(((first - 360) * FREE_SHARE.MORNING)) })
  }
  const last = toMin(out[out.length - 1]!.end)
  if (last < 22 * 60 && !out.some((b) => b.block === "EVENING")) {
    out.push({ block: "EVENING", start: fmt(last), end: "22:00", freeMinutes: 22 * 60 - last })
  }
  const end = toMin(out[out.length - 1]!.end)
  if (end < 24 * 60 && !out.some((b) => b.block === "NIGHT")) {
    out.push({ block: "NIGHT", start: fmt(end), end: "24:00", freeMinutes: Math.round((24 * 60 - end) * FREE_SHARE.NIGHT) })
  }
  return out
}

export const blockAt = (blocks: DayBlock[], nowMin: number): DayBlock =>
  blocks.find((b) => nowMin >= toMin(b.start) && nowMin < toMin(b.end)) ?? {
    block: "NIGHT",
    start: "00:00",
    end: "06:00",
    freeMinutes: 0,
  }

// Free minutes left in the rest of today (the current block counts pro rata).
export const remainingFreeToday = (blocks: DayBlock[], nowMin: number): number =>
  Math.round(
    blocks.reduce((sum, b) => {
      const s = toMin(b.start)
      const e = toMin(b.end)
      if (e <= nowMin) return sum
      if (s >= nowMin) return sum + b.freeMinutes
      return sum + (b.freeMinutes * (e - nowMin)) / (e - s)
    }, 0),
  )

// ---- candidates ------------------------------------------------------

export const DEFAULT_SIZE = 25
export const SMALLEST = 2

export interface HabitSize {
  minutes: number
  label: string
}

export interface NowCandidate {
  sourceType: "TASK" | "HABIT"
  sourceId: string
  title: string
  block: Block | null // null = anytime (but never during office hours)
  sizeMinutes: number | null
  sizes?: HabitSize[]
  anchor?: string | null // "after my morning coffee"
  minimum: string | null
  tier: Tier
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  dueKey: string | null
  order: number // creation time: earlier project work first on ties
  areaName: string | null
  goalTitle: string | null
  goalWhy: string | null
}

export interface NowOption {
  sourceType: "TASK" | "HABIT"
  sourceId: string
  title: string
  minutes: number // how long this takes now (the smaller version when applicable)
  smaller: boolean
  minimum: string
  why: string
}

export type NowKind = "PICK" | "REST" | "EMPTY"

export interface NowInput {
  nowMin: number
  todayKey: string
  weekday: number // 0 = Sunday
  dayOfMonth: number
  blocks: DayBlock[]
  mode: Mode
  minutes: number | null // "I have 20 minutes"
  gapDays: number // days since the person last did anything
  forceSmaller?: boolean // "just the smallest step" (a low day), without calling it a busy week
  candidates: NowCandidate[]
}

export interface NowResult {
  kind: NowKind
  mode: Mode
  block: Block
  availableMinutes: number
  smaller: boolean
  freshStart: boolean
  welcomeBack: boolean
  message: string
  options: NowOption[]
}

const TIER_WEIGHT: Record<Tier, number> = { MAIN: 100, SECONDARY: 60, MAINTAIN: 25, LATER: 0 }
const PRIORITY_WEIGHT = { LOW: 0, MEDIUM: 8, HIGH: 18, CRITICAL: 28 } as const

export const SMALLER_AFTER_DAYS = 2
export const WELCOME_BACK_AFTER_DAYS = 14

// Rule 1: only items that fit the block. Office hours take office items only;
// everything else keeps off the office hours.
export const fitsBlock = (item: Block | null, current: Block): boolean =>
  current === "OFFICE" ? item === "OFFICE" : item === null || item === current

const rankScore = (c: NowCandidate, todayKey: string, minutes: number, size: number): number => {
  let s = TIER_WEIGHT[c.tier] + (c.priority ? PRIORITY_WEIGHT[c.priority] : 0)
  if (c.dueKey) s += c.dueKey < todayKey ? 25 : c.dueKey === todayKey ? 15 : 0
  if (c.goalTitle) s += 10
  // A habit anchored to this part of the day is exactly what belongs here.
  if (c.anchor && c.block) s += 12
  // "I have 20 minutes": prefer what fills them without overflowing.
  s += Math.max(0, 10 - Math.abs(minutes - size) / 3)
  return s
}

// Rule 4: office hours rank by deadline, then priority, then project order.
const officeOrder = (a: NowCandidate, b: NowCandidate): number => {
  const ad = a.dueKey ?? "9999-12-31"
  const bd = b.dueKey ?? "9999-12-31"
  if (ad !== bd) return ad < bd ? -1 : 1
  const ap = PRIORITY_WEIGHT[a.priority ?? "MEDIUM"]
  const bp = PRIORITY_WEIGHT[b.priority ?? "MEDIUM"]
  return bp - ap || a.order - b.order
}

const sizeFor = (c: NowCandidate, minutes: number, minimumOnly: boolean): { minutes: number; smaller: boolean } | null => {
  const natural = c.sizeMinutes ?? DEFAULT_SIZE
  const sizes = [...(c.sizes ?? [])].sort((a, b) => a.minutes - b.minutes)
  if (minimumOnly) return { minutes: sizes[0]?.minutes ?? SMALLEST, smaller: true }
  if (natural <= minutes) return { minutes: natural, smaller: false }
  const fit = [...sizes].reverse().find((s) => s.minutes <= minutes)
  if (fit) return { minutes: fit.minutes, smaller: true }
  return c.minimum ? { minutes: SMALLEST, smaller: true } : null
}

const REST_INTENTION = "Rest on purpose: 10 minutes, no phone, then see how you feel."

export const rightNow = (input: NowInput): NowResult => {
  const block = blockAt(input.blocks, input.nowMin)
  const base = { mode: input.mode, block: block.block, freshStart: false, welcomeBack: false, smaller: false, options: [] as NowOption[] }

  // Rule 2: mode first. Sick means rest, nothing asked of you.
  if (input.mode === "SICK") {
    return { ...base, kind: "REST", availableMinutes: 0, message: "You're in sick mode. Rest and drink water. Nothing else is needed from you today." }
  }

  const welcomeBack = input.gapDays >= WELCOME_BACK_AFTER_DAYS
  const smallerAfterAbsence = input.gapDays >= SMALLER_AFTER_DAYS
  const minimumOnly = input.mode !== "NORMAL" || smallerAfterAbsence || input.forceSmaller === true
  // Rule 8: Monday, the 1st, and after a break are fresh starts: one clean step.
  const freshStart = welcomeBack || input.weekday === 1 || input.dayOfMonth === 1

  const available = input.minutes ?? (block.freeMinutes > 0 ? block.freeMinutes : block.block === "OFFICE" ? 60 : 30)

  const fitting = input.candidates.filter((c) => c.tier !== "LATER" && fitsBlock(c.block, block.block))
  const sized = fitting
    .map((c) => ({ c, size: sizeFor(c, available, minimumOnly) }))
    .filter((x): x is { c: NowCandidate; size: { minutes: number; smaller: boolean } } => x.size !== null)

  const ranked =
    block.block === "OFFICE"
      ? sized.sort((a, b) => officeOrder(a.c, b.c))
      : sized.sort(
          (a, b) =>
            rankScore(b.c, input.todayKey, available, b.size.minutes) - rankScore(a.c, input.todayKey, available, a.size.minutes) ||
            a.c.title.localeCompare(b.c.title),
        )

  const options: NowOption[] = ranked.slice(0, freshStart ? 1 : 3).map(({ c, size }) => ({
    sourceType: c.sourceType,
    sourceId: c.sourceId,
    title: c.title,
    minutes: size.minutes,
    smaller: size.smaller,
    minimum: c.minimum?.trim() || "Just start. 2 minutes on it counts.",
    why: block.block === "OFFICE" ? officeWhy(c, input.todayKey) : c.anchor ? anchorWhy(c.anchor) : whyFor({ ...c, sourceType: c.sourceType, minimumVersion: c.minimum, areaId: null, goalId: null }),
  }))

  const state = { ...base, mode: input.mode, block: block.block, availableMinutes: available, smaller: minimumOnly, freshStart, welcomeBack }

  if (!options.length) {
    return {
      ...state,
      kind: fitting.length ? "REST" : "EMPTY",
      message: fitting.length
        ? `Nothing fits ${available} minutes. ${REST_INTENTION}`
        : block.block === "OFFICE"
          ? "Nothing for office hours is waiting. Add what you're working on and I'll order it by deadline."
          : `Nothing is waiting for this part of the day. ${REST_INTENTION}`,
    }
  }

  const top = options[0]!
  const lead = welcomeBack
    ? "Welcome back. Nothing is lost. "
    : smallerAfterAbsence
      ? `It's been ${input.gapDays} days. No restart needed. `
      : input.mode === "BUSY"
        ? "Busy week: the smallest version counts. "
        : ""
  const how = top.smaller ? `just ${top.minimum.replace(/\.$/, "").toLowerCase()} (${top.minutes} min)` : `${top.title} (${top.minutes} min)`
  return { ...state, kind: "PICK", message: `${lead}${block.block === "OFFICE" ? "First up" : "Right now"}: ${how}. ${top.why}`.replace(/\s+/g, " ").trim(), options }
}

const anchorWhy = (anchor: string): string => {
  const a = anchor.trim().replace(/[.!]$/, "")
  return /^(after|before|when|once)\b/i.test(a) ? `${a[0]!.toUpperCase()}${a.slice(1)}.` : `After ${a}.`
}

const officeWhy = (c: NowCandidate, todayKey: string): string => {
  if (c.dueKey && c.dueKey < todayKey) return "It's past its deadline."
  if (c.dueKey === todayKey) return "It's due today."
  if (c.dueKey) return `Due ${c.dueKey}.`
  return c.priority === "HIGH" || c.priority === "CRITICAL" ? "It's your highest priority." : "Next in your work order."
}

// ---- rule 6: the capacity guard --------------------------------------

export interface PlannedItem {
  id: string
  title: string
  minutes: number
  rank: number // lower = keep first
}

export interface CapacityResult {
  plannedMinutes: number
  freeMinutes: number
  over: boolean
  keep: string[]
  move: string[]
  message: string
}

const hours = (m: number) => (m >= 90 ? `${(m / 60).toFixed(1).replace(/\.0$/, "")} h` : `${Math.round(m)} min`)

// Never silently overload: if what is planned for today exceeds the free
// time left, propose what stays (by rank, as much as fits) and what moves.
export const capacityGuard = (items: PlannedItem[], freeMinutes: number): CapacityResult => {
  const planned = items.reduce((s, i) => s + i.minutes, 0)
  const sorted = [...items].sort((a, b) => a.rank - b.rank)
  const keep: string[] = []
  let used = 0
  for (const i of sorted) {
    if (used + i.minutes <= freeMinutes || (!keep.length && freeMinutes > 0)) {
      keep.push(i.id)
      used += i.minutes
    }
  }
  const over = planned > freeMinutes
  const move = over ? sorted.filter((i) => !keep.includes(i.id)).map((i) => i.id) : []
  return {
    plannedMinutes: planned,
    freeMinutes,
    over,
    keep: over ? keep : sorted.map((i) => i.id),
    move,
    message: over
      ? `${hours(planned)} planned for ${hours(freeMinutes)} of free time today. Keep ${keep.length} for today and move ${move.length} to later?`
      : "",
  }
}
