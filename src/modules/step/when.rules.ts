/* =====================================================================
   The four kinds of "when" a step can have (ALLY.md 5.0 #40). Pure code.

     ON a day    "tomorrow", "on Saturday"   hidden until that day
     BY a day    "by Friday"                 any day until then
     a WINDOW    "6 to 8 am", "mornings"     suggested only inside those hours
     ANYTIME     nothing said                the normal free-time rules

   A day and a window can go together ("tomorrow morning"). The AI may read
   "when" from what is said; checkWhen keeps only what is valid, and
   parseWhen reads the plain cases (English and Hinglish) with no AI.
   ===================================================================== */

export const DUE_KINDS = ["ON", "BY"] as const
export type DueKind = (typeof DUE_KINDS)[number]

export interface When {
  dueKind: DueKind | null
  dueKey: string | null // YYYY-MM-DD
  windowFrom: string | null // "HH:MM"
  windowTo: string | null
}

export const ANYTIME: When = { dueKind: null, dueKey: null, windowFrom: null, windowTo: null }

// A part of the day said in words becomes set hours.
export const PARTS = {
  MORNING: ["06:00", "09:00"],
  AFTERNOON: ["12:00", "16:00"],
  EVENING: ["18:00", "21:00"],
  NIGHT: ["21:00", "23:00"],
} as const
export type Part = keyof typeof PARTS

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const KEY = /^\d{4}-\d{2}-\d{2}$/
export const isHhmm = (v: unknown): v is string => typeof v === "string" && HHMM.test(v)
export const isDayKey = (v: unknown): v is string => typeof v === "string" && KEY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

const addDays = (key: string, n: number): string => {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** A date with no kind is an older to-do: it keeps behaving as "by". */
export const kindOf = (w: Pick<When, "dueKind" | "dueKey">): DueKind | null => (w.dueKey ? (w.dueKind ?? "BY") : null)

/** Inside the window right now? A window may run past midnight ("22:00 to 01:00"). */
export const inWindow = (w: Pick<When, "windowFrom" | "windowTo">, nowMin: number): boolean => {
  if (!w.windowFrom || !w.windowTo) return true
  const from = minutesOf(w.windowFrom)
  const to = minutesOf(w.windowTo)
  return from <= to ? nowMin >= from && nowMin < to : nowMin >= from || nowMin < to
}

/**
 * May this step be suggested right now?
 * "On a day" waits for its day; a window is only offered inside its hours.
 * A one-off whose window has passed simply comes back in tomorrow's window.
 */
export const whenAllows = (w: When, todayKey: string, nowMin: number): boolean => {
  if (kindOf(w) === "ON" && w.dueKey! > todayKey) return false
  return inWindow(w, nowMin)
}

/**
 * For planning the day (not "right now"): a window that has not finished yet
 * still belongs to the day, so it is placed where its hours fall instead of
 * waiting out of sight until they begin. "On a day" still waits for its day.
 */
export const whenAllowsAhead = (w: When, todayKey: string, nowMin: number): boolean => {
  if (kindOf(w) === "ON" && w.dueKey! > todayKey) return false
  if (!w.windowFrom || !w.windowTo) return true
  const from = minutesOf(w.windowFrom)
  const to = minutesOf(w.windowTo)
  // A window past midnight is never over before the day ends.
  return from > to || nowMin < to
}

/** The part of the day a window falls in, as a day block ("6 to 8 am" is MORNING); null when no block fits (the afternoon). */
export const blockForWindow = (windowFrom: string | null | undefined): "MORNING" | "EVENING" | "NIGHT" | null => {
  if (!windowFrom || !isHhmm(windowFrom)) return null
  const m = minutesOf(windowFrom)
  if (m >= 21 * 60 || m < 4 * 60) return "NIGHT"
  if (m >= 17 * 60) return "EVENING"
  if (m < 11 * 60) return "MORNING"
  return null
}

const hourWords = (hhmm: string): string => {
  const m = minutesOf(hhmm)
  const h = Math.floor(m / 60)
  const mm = m % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return mm ? `${h12}:${String(mm).padStart(2, "0")}` : `${h12}`
}

const partWords = (hhmm: string): string => {
  const h = Math.floor(minutesOf(hhmm) / 60)
  return h < 4 ? "Nights" : h < 12 ? "Mornings" : h < 17 ? "Afternoons" : h < 21 ? "Evenings" : "Nights"
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const dayWords = (key: string, todayKey: string): string => {
  const n = daysBetween(todayKey, key)
  if (n === 0) return "Today"
  if (n === 1) return "Tomorrow"
  const d = new Date(`${key}T00:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** "Tomorrow", "By Fri 21 Nov", "Mornings 6 to 8", "Tomorrow, 6 to 8". Null for anytime. */
export const whenWords = (w: When, todayKey: string): string | null => {
  const kind = kindOf(w)
  const hours = w.windowFrom && w.windowTo ? `${hourWords(w.windowFrom)} to ${hourWords(w.windowTo)}` : null
  if (!kind) return hours ? `${partWords(w.windowFrom!)} ${hours}` : null
  const late = w.dueKey! < todayKey
  const day = dayWords(w.dueKey!, todayKey)
  // A day that has gone by is said plainly, never as "overdue".
  const base = kind === "BY" ? (late ? `Was by ${day}` : day === "Today" || day === "Tomorrow" ? `By ${day.toLowerCase()}` : `By ${day}`) : late ? "Today" : day
  return hours ? `${base}, ${hours}` : base
}

/** Keep only what is valid from a caller or the AI. A window needs both ends; a kind needs a day. */
export const checkWhen = (raw: { dueKind?: unknown; dueKey?: unknown; windowFrom?: unknown; windowTo?: unknown }, todayKey: string, maxDaysAhead = 730): When => {
  const dueKey = isDayKey(raw.dueKey) && daysBetween(todayKey, raw.dueKey) >= 0 && daysBetween(todayKey, raw.dueKey) <= maxDaysAhead ? raw.dueKey : null
  const dueKind = dueKey ? (raw.dueKind === "BY" ? "BY" : "ON") : null
  const window = isHhmm(raw.windowFrom) && isHhmm(raw.windowTo) && raw.windowFrom !== raw.windowTo
  return { dueKind, dueKey, windowFrom: window ? (raw.windowFrom as string) : null, windowTo: window ? (raw.windowTo as string) : null }
}

/* ---------- reading "when" from plain words, with no AI ---------- */

const BY_WORDS = /\b(?:by|before|until|till|untill|no later than|deadline|due|tak|se pehle|se pahle)\b/i

const DAY_NAMES: [RegExp, number][] = [
  [/\b(?:sunday|ravivar|itvaar|itwar)\b/i, 0],
  [/\b(?:monday|mon|somvar|somwar)\b/i, 1],
  [/\b(?:tuesday|tues|tue|mangalvar|mangalwar)\b/i, 2],
  [/\b(?:wednesday|wed|budhvar|budhwar)\b/i, 3],
  [/\b(?:thursday|thurs|thu|guruvar|guruwar)\b/i, 4],
  [/\b(?:friday|fri|shukravar|shukrawar)\b/i, 5],
  [/\b(?:saturday|shanivar|shaniwar)\b/i, 6],
]
const MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
const DATE_DM = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b`, "i")
const DATE_MD = new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i")
const DATE_TH = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i

const TODAY = /\b(?:today|tonight|aaj|this\s+(?:morning|afternoon|evening))\b/i
const TOMORROW = /\b(?:tomorrow|tmrw|tmr|tomm?orow|kal)\b/i
const DAY_AFTER = /\b(?:day\s+after(?:\s+tomorrow)?|parso|parson)\b/i
const WEEKEND = /\b(?:this\s+)?weekend\b/i
const NEXT_WEEK = /\bnext\s+week\b/i

const PART_WORDS: [RegExp, Part][] = [
  [/\b(?:(?:in\s+the\s+|every\s+|each\s+)?mornings?|subah|savere|sawere)\b/i, "MORNING"],
  [/\b(?:(?:in\s+the\s+|every\s+)?afternoons?|dopahar|dopeher)\b/i, "AFTERNOON"],
  [/\b(?:(?:in\s+the\s+|every\s+)?evenings?|shaam|sham)\b/i, "EVENING"],
  [/\b(?:(?:at\s+|every\s+)?nights?|tonight|raat)\b/i, "NIGHT"],
]

// "6 to 8 am", "6-8", "6:30 se 8 baje", "between 18:00 and 20:00". Not "5-10 pages".
const RANGE =
  /\b(?:from\s+|between\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|and|se|till|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?(?:\s*baje)?(?!\s*(?:pages?|min(?:ute)?s?|mins?|km|kms|times|reps?|sets?|glass(?:es)?|hours?|hrs?|kg|kgs|days?|weeks?|months?|years?|lpa|k\b|%|people|chapters?|questions?|problems?|rounds?|steps?))\b/i

const pad = (n: number) => String(n).padStart(2, "0")

const readRange = (text: string, part: Part | null): { from: string; to: string; match: string } | null => {
  const m = RANGE.exec(text)
  if (!m) return null
  let h1 = Number(m[1])
  let h2 = Number(m[4])
  const m1 = m[2] ? Number(m[2]) : 0
  const m2 = m[5] ? Number(m[5]) : 0
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null
  const ap1 = (m[3] ?? m[6])?.toLowerCase() // "6 to 8 am": the first hour takes the second's am/pm
  const ap2 = (m[6] ?? m[3])?.toLowerCase()
  const to24 = (h: number, ap: string | undefined) => (ap === "pm" && h < 12 ? h + 12 : ap === "am" && h === 12 ? 0 : h)
  if (ap1 || ap2) {
    // "10 to 2 pm" starts in the morning.
    h1 = m[3] ? to24(h1, ap1) : ap2 === "pm" && h1 > h2 && h1 < 12 ? h1 : to24(h1, ap1)
    h2 = to24(h2, ap2)
  } else if (h1 <= 12 && h2 <= 12) {
    // Bare "6-8": the part of the day said decides; otherwise 5 to 11 reads as morning, 1 to 4 as afternoon.
    const pm = part === "EVENING" || part === "NIGHT" || part === "AFTERNOON" || (part === null && h1 >= 1 && h1 <= 4)
    if (pm) {
      if (h1 < 12) h1 += 12
      if (h2 < 12) h2 += 12
    }
  }
  if (h1 === h2 && m1 === m2) return null
  return { from: `${pad(h1)}:${pad(m1)}`, to: `${pad(h2)}:${pad(m2)}`, match: m[0] }
}

const monthIndex = (word: string): number => MONTHS.findIndex((x) => x.toLowerCase() === word.slice(0, 3).toLowerCase())

const readDay = (text: string, todayKey: string): { key: string; match: string } | null => {
  let m: RegExpExecArray | null
  if ((m = DAY_AFTER.exec(text))) return { key: addDays(todayKey, 2), match: m[0] }
  if ((m = TOMORROW.exec(text))) return { key: addDays(todayKey, 1), match: m[0] }
  if ((m = TODAY.exec(text))) return { key: todayKey, match: /^this/i.test(m[0]) ? "this" : m[0] }
  if ((m = NEXT_WEEK.exec(text))) {
    const wd = new Date(`${todayKey}T00:00:00Z`).getUTCDay()
    return { key: addDays(todayKey, ((1 - wd + 7) % 7) || 7), match: m[0] }
  }
  if ((m = WEEKEND.exec(text))) {
    const wd = new Date(`${todayKey}T00:00:00Z`).getUTCDay()
    return { key: addDays(todayKey, (6 - wd + 7) % 7), match: m[0] }
  }
  for (const [re, target] of DAY_NAMES) {
    if ((m = re.exec(text))) {
      const wd = new Date(`${todayKey}T00:00:00Z`).getUTCDay()
      // Said on a Friday, "Friday" means the next one.
      return { key: addDays(todayKey, ((target - wd + 7) % 7) || 7), match: m[0] }
    }
  }
  const year = Number(todayKey.slice(0, 4))
  const dated = (day: number, month: number, match: string) => {
    if (day < 1 || day > 31 || month < 0) return null
    let key = `${year}-${pad(month + 1)}-${pad(day)}`
    if (!isDayKey(key) || new Date(`${key}T00:00:00Z`).getUTCDate() !== day) return null
    if (key < todayKey) key = `${year + 1}-${pad(month + 1)}-${pad(day)}`
    return { key, match }
  }
  if ((m = DATE_DM.exec(text))) return dated(Number(m[1]), monthIndex(m[2]!), m[0])
  if ((m = DATE_MD.exec(text))) return dated(Number(m[2]), monthIndex(m[1]!), m[0])
  if ((m = DATE_TH.exec(text))) {
    // "the 20th": this month, or next month once it has passed.
    const day = Number(m[1])
    const month = Number(todayKey.slice(5, 7)) - 1
    const here = `${year}-${pad(month + 1)}-${pad(day)}`
    if (isDayKey(here) && new Date(`${here}T00:00:00Z`).getUTCDate() === day && here >= todayKey) return { key: here, match: m[0] }
    const next = new Date(Date.UTC(year, month + 1, day))
    return next.getUTCDate() === day ? { key: next.toISOString().slice(0, 10), match: m[0] } : null
  }
  return null
}

export interface ParsedWhen extends When {
  /** The words with the "when" taken out, for a title that stays true next week. */
  rest: string
}

/** Reads by/before, today, tomorrow, weekdays, dates, parts of the day and "6-8" from plain words. */
export const parseWhen = (text: string, todayKey: string): ParsedWhen => {
  const found: string[] = []
  let part: Part | null = null
  for (const [re, p] of PART_WORDS) {
    const m = re.exec(text)
    if (m) {
      part = p
      // "tonight" is also the day; readDay takes it out.
      if (!/tonight/i.test(m[0])) found.push(m[0])
      break
    }
  }
  const range = readRange(text, part)
  if (range) found.push(range.match)
  const day = readDay(text, todayKey)
  if (day) found.push(day.match)
  const by = BY_WORDS.exec(text)

  const windowFrom = range ? range.from : part ? PARTS[part][0] : null
  const windowTo = range ? range.to : part ? PARTS[part][1] : null

  let rest = text
  for (const f of found.sort((a, b) => b.length - a.length)) rest = rest.replace(f, " ")
  if (day && by) rest = rest.replace(by[0], " ")
  rest = rest
    .replace(/\s+/g, " ")
    .replace(/\s+(?:on|by|at|in|before|from|between|every|this|next|the|ko|se|tak)\s*$/i, "")
    .replace(/^(?:on|by|at|in|every)\s+/i, "")
    .replace(/[\s,;:-]+$/, "")
    .trim()
  if (rest.length < 3) rest = text.trim()

  return {
    dueKind: day ? (by ? "BY" : "ON") : null,
    dueKey: day?.key ?? null,
    windowFrom,
    windowTo,
    rest,
  }
}

/**
 * The AI's answer where it gave one, the plain words otherwise. The kind is
 * always read from the words: "by Friday" is a deadline whoever parsed the date.
 */
export const whenFor = (said: string, ai: { dueKey?: unknown; dueKind?: unknown; windowFrom?: unknown; windowTo?: unknown }, todayKey: string): When => {
  const words = parseWhen(said, todayKey)
  const checked = checkWhen({ ...ai, dueKind: ai.dueKind ?? (BY_WORDS.test(said) ? "BY" : "ON") }, todayKey)
  const dueKey = checked.dueKey ?? words.dueKey
  return {
    dueKey,
    dueKind: dueKey ? (checked.dueKey ? checked.dueKind : words.dueKind) : null,
    windowFrom: checked.windowFrom ?? words.windowFrom,
    windowTo: checked.windowFrom ? checked.windowTo : words.windowTo,
  }
}
