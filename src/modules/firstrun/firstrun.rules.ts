/* =====================================================================
   First run (ALLY.md 2.1): everything someone wants, sorted into areas,
   and a mode for each. The AI may split and label; these rules check
   every field, sort without AI when none answers, and suggest modes by
   code from deadlines and the words used. Nothing personal is built in.
   ===================================================================== */
import { daysBetweenKeys } from "../../shared/utils/time.util.js"
import { splitDump } from "../now/dump.rules.js"
import type { OnboardingExtraction } from "../onboarding/onboarding.extract.js"

export type Kind = "GOAL" | "TASK" | "HABIT"
export type Mode = "PUSH" | "MAINTAIN" | "EXPLORE" | "REST"

export interface SortItem {
  title: string
  kind: Kind
  areaName: string
  due: string | null // YYYY-MM-DD
}

export interface SortArea {
  name: string
  mode: Mode
  reason: string
}

export const MAX_AREAS = 8
export const MAX_ITEMS = 30
export const MAX_PUSH = 2
export const OTHER = "Other"

// A small generic set, used only when no AI answers. The person renames or moves anything.
const AREA_WORDS: [string, RegExp][] = [
  ["Career", /\b(job|work|career|resume|cv|interview|office|promotion|dsa|coding|lpa|salary|client|naukri|business)\b/i],
  ["Health", /\b(weight|gym|run|running|walk|fit|fitness|exercise|yoga|knee|diet|eat|eating|sleep|doctor|health|workout)\b/i],
  ["Money", /\b(money|bill|bills|card|loan|saving|savings|invest|budget|rent|emi|tax|paisa)\b/i],
  ["Family and friends", /\b(mom|mum|maa|dad|papa|family|friend|friends|parents|sister|brother|wife|husband|kids|call home)\b/i],
  ["Learning", /\b(learn|read|reading|book|books|course|english|study|language|exam)\b/i],
  ["Home", /\b(clean|home|house|laundry|groceries|repair|cook|cooking)\b/i],
  ["Creative", /\b(music|guitar|draw|drawing|paint|painting|write|writing|content|youtube|photo|photography|song)\b/i],
]

export const guessArea = (title: string): string => AREA_WORDS.find(([, re]) => re.test(title))?.[0] ?? OTHER

const HABIT = /\b(every\s*(day|night|morning|week)|daily|each\s+day|roz|har\s+din|weekly|more often|regularly)\b/i
const GOAL = /\b(learn|become|get\s+(a|an|better|fit)|switch|lose|gain|build|start|improve|save\s+\d|crack|clear|reach|finish|launch|grow)\b/i

export const kindOf = (title: string): Kind => (HABIT.test(title) ? "HABIT" : GOAL.test(title) ? "GOAL" : "TASK")

// Without AI: one thing per line or sentence, an area guessed by plain words.
export const fallbackSort = (text: string): SortItem[] =>
  splitDump(text)
    .slice(0, MAX_ITEMS)
    .map((i) => ({ title: i.title, kind: kindOf(i.title), areaName: guessArea(i.title), due: null }))

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ").slice(0, max) : "")
const isKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))

// The AI's answer, kept where valid: a title, a known kind, a real future date,
// and an area that is in the list (anything else goes to a guessed area).
export const fromExtraction = (x: OnboardingExtraction, todayKey: string): SortItem[] => {
  const names = new Set(x.areas.map((a) => a.name))
  const out: SortItem[] = []
  for (const a of x.actions) {
    const title = clean(a.title, 120)
    if (!title) continue
    const kind: Kind = a.itemType === "GOAL" || a.itemType === "HABIT" ? a.itemType : "TASK"
    const due = isKey(a.dueDate) && a.dueDate >= todayKey ? a.dueDate : null
    out.push({ title, kind, areaName: names.has(a.areaName) ? a.areaName : guessArea(title), due })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

const EXPLORE = /\b(maybe|someday|some\s+day|try|trying|curious|explore|might|thinking\s+about|shayad|kabhi)\b/i
const URGENT = /\b(switch|interview|exam|deadline|lpa|salary|promotion|wedding|launch|in\s+\d+\s*(?:-\s*\d+\s*)?(?:weeks?|months?)|by\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/i
const DEADLINE_DAYS = 120

// The sentence(s) of what was said that mention this item.
const sentencesAbout = (text: string, title: string): string[] => {
  const words = title.toLowerCase().split(/\W+/).filter((w) => w.length >= 4)
  return text
    .split(/[\n.;!?]+/)
    .filter((s) => words.some((w) => s.toLowerCase().includes(w)))
}

/** A mode for each area, with a plain reason. Push is for at most two areas at once. */
export const suggestModes = (items: SortItem[], text: string, todayKey: string): SortArea[] => {
  const order: string[] = []
  for (const i of items) if (!order.includes(i.areaName)) order.push(i.areaName)
  const scored = order.slice(0, MAX_AREAS).map((name, idx) => {
    const mine = items.filter((i) => i.areaName === name)
    const said = mine.flatMap((i) => [i.title, ...sentencesAbout(text, i.title)]).join(" ")
    const soonest = mine
      .map((i) => (i.due ? daysBetweenKeys(todayKey, i.due) : null))
      .filter((d): d is number => d !== null && d >= 0)
      .sort((a, b) => a - b)[0]
    const hasGoal = mine.some((i) => i.kind === "GOAL")
    const exploring = EXPLORE.test(said)
    const urgent = (soonest !== undefined && soonest <= DEADLINE_DAYS) || URGENT.test(said)
    const score = urgent ? 3 : hasGoal && !exploring ? 2 : 0
    return { name, idx, score, exploring, urgent, hasGoal }
  })
  const push = new Set(
    [...scored]
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.idx - b.idx)
      .slice(0, MAX_PUSH)
      .map((s) => s.name),
  )
  return scored.map((s): SortArea => {
    if (push.has(s.name)) return { name: s.name, mode: "PUSH", reason: s.urgent ? "It has a deadline, so it gets most of your effort now." : "A clear goal you want to move on now." }
    if (s.exploring) return { name: s.name, mode: "EXPLORE", reason: "Try it before committing. It gets free time, no pressure." }
    if (s.score > 0) return { name: s.name, mode: "MAINTAIN", reason: "Push has room for two at a time. This can move up later." }
    return { name: s.name, mode: "MAINTAIN", reason: "Kept steady with a small, regular dose." }
  })
}

/** A week's starting time for a mode, in minutes. */
export const startingMinutes = (mode: Mode): number => (mode === "PUSH" ? 180 : mode === "REST" ? 0 : 60)

export const TIER: Record<Mode, "MAIN" | "MAINTAIN" | "SECONDARY" | "LATER"> = { PUSH: "MAIN", MAINTAIN: "MAINTAIN", EXPLORE: "SECONDARY", REST: "LATER" }
