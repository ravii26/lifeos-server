/* =====================================================================
   "My head is full" (canvas board 7, build plan Phase 1): a messy dump
   becomes separate things, sorted into "has a date / this week / can wait",
   with an honest time check. Pure rules: the AI only splits and labels
   (ADR 0004); every field it returns is checked here, and when no AI
   answers the dump is still split by plain code.
   ===================================================================== */
import { daysBetweenKeys } from "../../shared/utils/time.util.js"

export const DUMP_MAX_ITEMS = 25
export const DEFAULT_ITEM_MINUTES = 25
// Only this share of free time is planned (decisions log #13): the rest is for life.
export const PLANNED_SHARE = 0.7

export interface DumpItem {
  title: string
  due: string | null // YYYY-MM-DD
  minutes: number | null
  areaId: string | null
  soon: boolean // said as this week / today / urgent
}

export type DumpGroup = "DATED" | "THIS_WEEK" | "LATER"

const LEAD = /^(?:[-•*]+|\d+[.)]|i\s+(?:need|have|want|got)\s+to|i\s+should|need\s+to|have\s+to|want\s+to|should|also|and|aur|plus|then|phir|mujhe|ek)\s+/i
const SOON = /\b(?:today|tonight|tomorrow|tmrw|this\s+week|asap|urgent(?:ly)?|jaldi|aaj|kal|abhi|before\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day|by\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i
const FEELING = /^(?:i\s+(?:feel|am\s+feeling|am)\s+(?:so\s+)?(?:tired|stressed|lost|confused|overwhelmed|lazy|sad|low)|so\s+much\s+to\s+do|too\s+much|everything|my\s+head\s+is\s+full)\b/i

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]/g, "").replace(/\s+/g, " ").trim()
const tidy = (s: string) => {
  let t = s.trim()
  for (let i = 0; i < 3 && LEAD.test(t); i++) t = t.replace(LEAD, "").trim()
  t = t.replace(/[.!?]+$/, "").trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// Without AI: one thing per line, sentence, comma, "and" or "aur".
export const splitDump = (text: string): DumpItem[] => {
  const out: DumpItem[] = []
  const seen = new Set<string>()
  const parts = text
    .split(/\n|;|,|\.\s+|\s+(?:and|aur|also|plus|then|phir)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean)
  for (const raw of parts) {
    if (FEELING.test(raw)) continue
    const title = tidy(raw).slice(0, 200)
    const key = norm(title)
    if (title.length < 3 || seen.has(key)) continue
    seen.add(key)
    out.push({ title, due: null, minutes: null, areaId: null, soon: SOON.test(raw) })
    if (out.length >= DUMP_MAX_ITEMS) break
  }
  return out
}

// The AI's answer, kept only where it is valid: a real title, a date that is
// a real day and not in the past, minutes in range, and one of this person's areas.
export const parseDumpJson = (raw: string, ctx: { areaIds: Set<string>; todayKey: string }): DumpItem[] => {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const list = Array.isArray((data as { items?: unknown })?.items) ? ((data as { items: unknown[] }).items) : []
  const out: DumpItem[] = []
  const seen = new Set<string>()
  for (const x of list) {
    const o = (x ?? {}) as Record<string, unknown>
    const title = typeof o.title === "string" ? tidy(o.title).slice(0, 200) : ""
    const key = norm(title)
    if (title.length < 3 || seen.has(key)) continue
    seen.add(key)
    const due = typeof o.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.due) && !Number.isNaN(Date.parse(`${o.due}T00:00:00Z`)) && daysBetweenKeys(ctx.todayKey, o.due) >= 0 && daysBetweenKeys(ctx.todayKey, o.due) <= 730 ? o.due : null
    const m = Number(o.minutes)
    out.push({
      title,
      due,
      minutes: Number.isFinite(m) && m >= 5 && m <= 600 ? Math.round(m) : null,
      areaId: typeof o.areaId === "string" && ctx.areaIds.has(o.areaId) ? o.areaId : null,
      soon: o.soon === true,
    })
    if (out.length >= DUMP_MAX_ITEMS) break
  }
  return out
}

// Sorting is code, not AI: a date wins; then "this week" words; the rest can wait.
export const groupOf = (item: Pick<DumpItem, "due" | "soon">): DumpGroup => (item.due ? "DATED" : item.soon ? "THIS_WEEK" : "LATER")

export const hoursText = (minutes: number): string => {
  if (minutes < 60) return `${Math.max(5, Math.round(minutes / 5) * 5)} min`
  const h = Math.round(minutes / 30) / 2
  return `${h % 1 ? h.toFixed(1) : h} h`
}

// The honest time check. Fits only within 70% of free time, so the plan
// leaves room for life; otherwise it says so and offers to make it fit.
export const timeCheck = (weeklyMinutes: number, freeMinutes: number): { fits: boolean; line: string } => {
  const room = Math.round(freeMinutes * PLANNED_SHARE)
  if (freeMinutes <= 0) return { fits: false, line: `All of this needs about ${hoursText(weeklyMinutes)} a week. Tell Ally your day so it can find the time.` }
  if (weeklyMinutes <= room) return { fits: true, line: `About ${hoursText(weeklyMinutes)} a week. You have about ${hoursText(freeMinutes)} free, so it fits.` }
  return { fits: false, line: `All of this needs about ${hoursText(weeklyMinutes)} a week. You have about ${hoursText(freeMinutes)} free. It can't all happen at once, and that's not laziness. Let's make it fit.` }
}

export const dumpPrompt = (text: string, areas: { id: string; name: string }[], todayKey: string, weekday: string): string =>
  [
    "Split this person's brain dump into separate things to do. Return JSON only:",
    '{"items":[{"title":"short action in their own words","due":"YYYY-MM-DD or null","minutes":number or null,"areaId":"one id from the list or null","soon":true|false}]}',
    "Rules: one item per separate thing; keep their words (English or Hinglish); never invent things they didn't say;",
    "skip feelings and filler ('so much to do'); due only when they named a day or date;",
    "soon = true only for today/tomorrow/this week/urgent; minutes only when they said or it is obvious (a call = 10).",
    `Today is ${weekday} ${todayKey}. Areas: ${JSON.stringify(areas)}`,
    `Dump:\n${text.slice(0, 4000)}`,
  ].join("\n")
