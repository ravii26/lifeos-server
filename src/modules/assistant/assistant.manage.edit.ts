/* =====================================================================
   Changing things by name, by talking (plan 20, M2, ADR 0031):
   "set the gym habit to 7 am", "make passport 45 min", "make passport high
   priority", "move passport to friday", "set the guitar deadline to 30 nov",
   "make gym habit mon wed fri"; and areas: "add an area called music",
   "make health my main area", "move music to later".
   Pure: it only reads the sentence. assistant.manage.edit.service.ts acts.
   Anything that is not clearly one of these goes on to the AI.
   ===================================================================== */
import type { When } from "./assistant.followup.js"
import { quoted, readTarget, withoutQuotes, type Item, type Kind } from "./assistant.manage.js"

export type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"
export type Level = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
export type Tier = "MAIN" | "SECONDARY" | "MAINTAIN" | "LATER"

export type Edit =
  | { field: "TIME"; hour: number; minute: number; ampm: "am" | "pm" | null }
  | { field: "SIZE"; minutes: number }
  | { field: "PRIORITY"; level: Level }
  | { field: "WHEN"; when: When }
  | { field: "DATE"; day: number; month: number; year: number | null } // month 1 to 12
  | { field: "DAYS"; days: Day[] } // [] = every day

export interface EditIntent {
  edit: Edit
  kind: Kind | null
  name: string
  raw?: string
  // The person named the kind ("gym habit"): then "can't find" is worth saying.
  named: boolean
}

export type AreaIntent =
  | { op: "CREATE"; name: string }
  | { op: "TIER"; name: string; tier: Tier; confirmed: boolean }

const VERB = String.raw`(?:please\s+)?(?:set|change|make|move|update|put|reschedule|push|postpone|mark)`
const THAT = /^(?:it|that|this|them|those|these)$/i
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`
const DAYNAME = String.raw`(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`
const WHEN_WORDS = String.raw`(?:tomorrow|today|tonight|next week|(?:the |this )?weekend|(?:on |next |this )?${DAYNAME})`
const DATE_WORDS = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}(?:\s+\d{4})?|${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)`
const DAYS_WORDS = String.raw`(?:weekdays|weekends|every\s?day|daily|${DAYNAME}(?:\s*(?:,|and|&)?\s*${DAYNAME})+)`

const RE = {
  PRIORITY_A: new RegExp(String.raw`^${VERB}\s+(.+?)\s+(?:to\s+|as\s+)?(low|medium|normal|high|critical|urgent)\s+priority$`, "i"),
  PRIORITY_B: new RegExp(String.raw`^${VERB}\s+(?:the\s+)?priority\s+(?:of|for|on)\s+(.+?)\s+(?:to|as)\s+(low|medium|normal|high|critical|urgent)$`, "i"),
  PRIORITY_C: new RegExp(String.raw`^${VERB}\s+(.+?)\s+priority\s+(?:to|as)\s+(low|medium|normal|high|critical|urgent)$`, "i"),
  TIME_AMPM: new RegExp(String.raw`^${VERB}\s+(.+?)\s+(?:to|at|for)\s+(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)$`, "i"),
  TIME_COLON: new RegExp(String.raw`^${VERB}\s+(.+?)\s+(?:to|at|for)\s+(?:at\s+)?(\d{1,2}):(\d{2})$`, "i"),
  SIZE: new RegExp(String.raw`^${VERB}\s+(.+?)\s+(?:(?:to|at|for)\s+)?(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hours?|hrs?|h)$`, "i"),
  DAYS: new RegExp(String.raw`^${VERB}\s+(.+?)\s+(?:to|on|for)\s+(${DAYS_WORDS})$`, "i"),
  WHEN: new RegExp(String.raw`^${VERB}\s+(.+?)\s+(?:to|for|until|till|by|on)\s+(${WHEN_WORDS})$`, "i"),
  DATE: new RegExp(String.raw`^${VERB}\s+(.+?)\s+(?:to|for|until|till|by|on)\s+(${DATE_WORDS})$`, "i"),
  DATE_ISO: new RegExp(String.raw`^${VERB}\s+(.+?)\s+(?:to|for|until|till|by|on)\s+(\d{4})-(\d{2})-(\d{2})$`, "i"),
}

const FIELD_WORD = /\s+(?:reminder|time|alarm|deadline|due date|due|sessions?|session length|length|duration|size|priority)$/i

// "gym habit reminder" → target "gym habit"; "guitar deadline" → "guitar".
const target = (raw: string): { kind: Kind | null; name: string; raw: string; named: boolean } | null => {
  const withoutField = raw.trim().replace(FIELD_WORD, "")
  const t = readTarget(withoutField)
  if (!t.name || t.all || THAT.test(t.name) || THAT.test(withoutField.trim())) return null
  return { kind: t.kind, name: t.name, raw: t.raw, named: t.kind !== null }
}

const dayOf = (w: string): Day => (["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const)[["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(w.toLowerCase().slice(0, 3))]!

export const readDays = (raw: string): Day[] | null => {
  const w = raw.toLowerCase().trim()
  if (/^(?:every\s?day|daily)$/.test(w)) return []
  if (w === "weekdays") return ["MON", "TUE", "WED", "THU", "FRI"]
  if (w === "weekends") return ["SAT", "SUN"]
  const found = [...w.matchAll(new RegExp(DAYNAME, "g"))].map((m) => dayOf(m[0]))
  return found.length ? [...new Set(found)] : null
}

const WEEKDAY_NUMBER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
export const readWhen = (raw: string): When | null => {
  const w = raw.toLowerCase().trim().replace(/^(?:on|next|this|the)\s+/, "")
  if (w === "tomorrow") return { kind: "TOMORROW" }
  if (w === "today") return { kind: "TODAY" }
  if (w === "tonight") return { kind: "TONIGHT" }
  if (/^next week$/.test(raw.toLowerCase().trim()) || w === "week") return { kind: "NEXT_WEEK" }
  if (w.startsWith("weekend")) return { kind: "WEEKEND" }
  const i = WEEKDAY_NUMBER.indexOf(w.slice(0, 3))
  return i >= 0 ? { kind: "WEEKDAY", weekday: i } : null
}

const readDate = (raw: string): { day: number; month: number; year: number | null } | null => {
  const m = raw.toLowerCase().match(new RegExp(String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH})(?:\s+(\d{4}))?`)) ??
    null
  if (m) return { day: Number(m[1]), month: MONTHS.indexOf(m[2]!.slice(0, 3)) + 1, year: m[3] ? Number(m[3]) : null }
  const n = raw.toLowerCase().match(new RegExp(String.raw`(${MONTH})\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`))
  if (n) return { day: Number(n[2]), month: MONTHS.indexOf(n[1]!.slice(0, 3)) + 1, year: n[3] ? Number(n[3]) : null }
  return null
}

const level = (w: string): Level => {
  const l = w.toLowerCase()
  return l === "low" ? "LOW" : l === "high" ? "HIGH" : l === "critical" || l === "urgent" ? "CRITICAL" : "MEDIUM"
}

const done = (edit: Edit, t: ReturnType<typeof target>): EditIntent | null => (t ? { edit, kind: t.kind, name: t.name, raw: t.raw, named: t.named } : null)

export const editIntent = (text: string): EditIntent | null => {
  const t = text.trim().replace(/[.!]+$/, "")
  if (!t || t.split(/\s+/).length > 14 || /\bfrom\b/i.test(withoutQuotes(t))) return null
  let m: RegExpMatchArray | null

  if ((m = t.match(RE.PRIORITY_A)) ?? (m = t.match(RE.PRIORITY_C))) return done({ field: "PRIORITY", level: level(m[2]!) }, target(m[1]!))
  if ((m = t.match(RE.PRIORITY_B))) return done({ field: "PRIORITY", level: level(m[2]!) }, target(m[1]!))

  if ((m = t.match(RE.TIME_AMPM))) {
    const hour = Number(m[2]), minute = Number(m[3] ?? 0)
    return hour >= 1 && hour <= 12 && minute <= 59 ? done({ field: "TIME", hour, minute, ampm: m[4]!.toLowerCase() as "am" | "pm" }, target(m[1]!)) : null
  }
  if ((m = t.match(RE.TIME_COLON))) {
    const hour = Number(m[2]), minute = Number(m[3])
    return hour <= 23 && minute <= 59 ? done({ field: "TIME", hour, minute, ampm: null }, target(m[1]!)) : null
  }
  if ((m = t.match(RE.SIZE))) {
    const n = Number(m[2])
    const minutes = /^h/i.test(m[3]!) ? Math.round(n * 60) : Math.round(n)
    return minutes >= 1 && minutes <= 600 ? done({ field: "SIZE", minutes }, target(m[1]!)) : null
  }
  if ((m = t.match(RE.DAYS))) {
    const days = readDays(m[2]!)
    // One weekday alone is a date ("move passport to friday"), not a repeat pattern.
    const single = days !== null && days.length === 1 && !/weekend|weekday|every|daily/i.test(m[2]!)
    if (days && !single) return done({ field: "DAYS", days }, target(m[1]!))
  }
  if ((m = t.match(RE.DATE_ISO))) {
    return done({ field: "DATE", year: Number(m[2]), month: Number(m[3]), day: Number(m[4]) }, target(m[1]!))
  }
  if ((m = t.match(RE.DATE))) {
    const d = readDate(m[2]!)
    return d && d.day >= 1 && d.day <= 31 ? done({ field: "DATE", ...d }, target(m[1]!)) : null
  }
  if ((m = t.match(RE.WHEN))) {
    const when = readWhen(m[2]!)
    return when ? done({ field: "WHEN", when }, target(m[1]!)) : null
  }
  return null
}

// ---- areas ------------------------------------------------------------------------------------

const TIER_WORD: Record<string, Tier> = { main: "MAIN", primary: "MAIN", secondary: "SECONDARY", maintain: "MAINTAIN", maintenance: "MAINTAIN", later: "LATER" }
const CREATE_A = /^(?:please\s+)?(?:add|create|new|start)\s+(?:a\s+|an\s+|new\s+)*(?:life\s+)?area\s+(?:called\s+|named\s+|for\s+)?(.+)$/i
const CREATE_B = /^(?:please\s+)?(?:add|create)\s+(.+?)\s+as\s+(?:a\s+|an\s+)?(?:new\s+)?(?:life\s+)?area$/i
const TIER = new RegExp(String.raw`^${VERB}\s+(?:my\s+|the\s+)?(.+?)\s+(?:area\s+)?(?:to\s+|as\s+|into\s+)?(?:my\s+)?(main|primary|secondary|maintain|maintenance|later)(?:\s+(?:area|focus))?$`, "i")
const TIER_YES = /^yes[, ]+make\s+(.+?)\s+my\s+main\s+area$/i

export const areaIntent = (text: string): AreaIntent | null => {
  const t = text.trim().replace(/[.!]+$/, "")
  if (!t || t.split(/\s+/).length > 12) return null
  const yes = t.match(TIER_YES)
  if (yes) return { op: "TIER", name: yes[1]!.trim().replace(/^"|"$/g, ""), tier: "MAIN", confirmed: true }
  const c = t.match(CREATE_A) ?? t.match(CREATE_B)
  if (c) {
    const name = c[1]!.trim().replace(/^["']|["']$/g, "").replace(/\s+area$/i, "").slice(0, 60)
    return name.length >= 2 && !THAT.test(name) ? { op: "CREATE", name } : null
  }
  const m = t.match(TIER)
  if (m) {
    const name = readTarget(m[1]!.replace(/\s+area$/i, "")).name || m[1]!.trim()
    if (!name || THAT.test(name)) return null
    return { op: "TIER", name, tier: TIER_WORD[m[2]!.toLowerCase()]!, confirmed: false }
  }
  return null
}

// ---- "which one?" choices, as commands that parse again -------------------------------------------

export const editValueText = (e: Edit): string => {
  switch (e.field) {
    case "TIME":
      return e.ampm ? `${e.hour}${e.minute ? `:${String(e.minute).padStart(2, "0")}` : ""} ${e.ampm}` : `${e.hour}:${String(e.minute).padStart(2, "0")}`
    case "SIZE":
      return `${e.minutes} min`
    case "PRIORITY":
      return `${e.level.toLowerCase()} priority`
    case "WHEN":
      return e.when.kind === "WEEKDAY" ? WEEKDAY_NUMBER[e.when.weekday]! : e.when.kind === "NEXT_WEEK" ? "next week" : e.when.kind.toLowerCase()
    case "DATE":
      return `${e.day} ${MONTHS[e.month - 1]}${e.year ? ` ${e.year}` : ""}`
    case "DAYS":
      return e.days.length ? e.days.map((d) => d.toLowerCase()).join(" ") : "every day"
  }
}

export const editChoiceText = (item: Item, e: Edit): string => {
  const label = { HABIT: "habit", TASK: "to-do", REMINDER: "reminder", PROJECT: "goal", NOTE: "note", AREA: "area" }[item.kind]
  return `Set ${label}: ${quoted(item.title)} to ${editValueText(e)}`
}
