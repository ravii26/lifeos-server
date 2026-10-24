/* =====================================================================
   Counts and Log (plan 16 §6, doc 18 item 4), decided by code, no AI.
   - COUNT: "+1 water", "drank 2 glasses" add to a count habit.
   - ENTRY: "spent 250 on lunch", "slept 6 hours", "weight 74.2" are written
     to the Log (money, sleep, weight).
   - ASK: "how much did I spend this month?", "how did I sleep this week?",
     "what's my weight?" are answered from the Log.
   Anything not clearly one of these returns null and the AI decides as
   before. Replies are plain numbers: no judging, no streaks, no red.
   ===================================================================== */

export type LogSeries = "money" | "sleep" | "weight"
export type LogPeriod = "TODAY" | "YESTERDAY" | "WEEK" | "LAST_7" | "MONTH" | "LAST_MONTH"

export type LogIntent =
  | { kind: "COUNT"; n: number; what: string }
  | { kind: "ENTRY"; series: LogSeries; value: number; unit: string; label: string | null; dayOffset: 0 | -1 }
  | { kind: "ASK"; series: LogSeries; period: LogPeriod | null; label: string | null }

export interface LogRow {
  value: number
  label: string | null
  date: string // YYYY-MM-DD, the person's local day
  createdAt: Date
}

const UNITS: Record<LogSeries, string> = { money: "₹", sleep: "h", weight: "kg" }
const MAX_WORDS = 14

// ---- reading what was said --------------------------------------------------

const PERIODS: [RegExp, LogPeriod][] = [
  [/\b(?:last|past) 7 days\b|\bpast week\b|\bover the last week\b/i, "LAST_7"],
  [/\blast week\b/i, "LAST_7"],
  [/\blast month\b/i, "LAST_MONTH"],
  [/\bthis month\b|\bso far this month\b/i, "MONTH"],
  [/\bthis week\b/i, "WEEK"],
  [/\byesterday\b/i, "YESTERDAY"],
  [/\btoday\b|\btill now\b|\bso far today\b/i, "TODAY"],
]

const takePeriod = (t: string): { period: LogPeriod | null; rest: string } => {
  for (const [re, period] of PERIODS) {
    if (re.test(t)) return { period, rest: t.replace(re, " ").replace(/\s+/g, " ").trim() }
  }
  return { period: null, rest: t }
}

const num = (s: string): number => Number(s.replace(/,/g, ""))

// "my lunch", "the cab" -> "lunch", "cab"
const tidyLabel = (s: string | undefined): string | null => {
  const label = (s ?? "")
    .replace(/\b(?:today|yesterday|just now|earlier|this morning|last night)\b/gi, " ")
    .replace(/^(?:my|the|a|an|some)\s+/i, "")
    .replace(/[?.!,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
  return label.length >= 2 ? label.slice(0, 40) : null
}

const TIME_WORD = /^(?:h|hr|hrs|hour|hours|min|mins|minute|minutes|day|days|week|weeks|month|months)\b/i

const SPEND = /^(?:i\s+)?(?:spent|paid)\s+(?:rs\.?\s*|inr\s*|₹\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:rs\.?|rupees|inr|₹|bucks)?\s*(?:on|for|at|to)?\s*(.{0,60})$/i
const SPEND_SHORT = /^(?:rs\.?\s*|₹\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:rs\.?|rupees|₹)?\s+(?:on|for)\s+(.{2,40})$/i
const SLEEP = /^(?:i\s+)?(?:slept|sleep)\s+(?:for\s+|only\s+|about\s+|around\s+)?(\d{1,2}(?:\.\d)?)\s*(?:h|hr|hrs|hours?)?$/i
const SLEEP_GOT = /^(?:i\s+)?got\s+(\d{1,2}(?:\.\d)?)\s*(?:h|hr|hrs|hours?)\s+(?:of\s+)?sleep$/i
const WEIGHT = /^(?:my\s+)?weight\s*(?:is|was|:|=)?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|kgs)?$/i
const WEIGH = /^(?:i\s+)?(?:weigh|weighed)\s+(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|kgs)?$/i

const COUNT_PLUS = /^\+\s*(\d{1,2})\s+(.{2,40})$/
const COUNT_PLUS_AFTER = /^(.{2,40}?)\s*\+\s*(\d{1,2})$/
const COUNT_VERB = /^(?:i\s+)?(?:drank|had|ate|took|did)\s+(\d{1,2})\s+(.{2,40})$/i
const COUNT_ONE = /^(?:i\s+)?(?:drank|had)\s+(?:a\s+|one\s+|1\s+)?((?:glass|cup|bottle)(?:es|s)?\s+of\s+water|water)$/i

const ASK_SPEND = /^(?:how much|what)\s+(?:did|have|do)\s+i\s+(?:spend|spent)\b(.*)$/i
const ASK_SPEND_TOTAL = /^(?:how much|what)(?:'s| is| was| were)?\s+(?:my\s+)?(?:total\s+)?(?:spending|expenses?)\b(.*)$/i
const ASK_SLEEP = /^(?:how (?:much |well )?did i sleep|how (?:much|well) have i (?:slept|been sleeping)|(?:what(?:'s| is) )?my (?:average )?sleep|average sleep)\b/i
const ASK_WEIGHT = /^(?:what(?:'s| is) my weight|how(?:'s| is) my weight|(?:my )?weight (?:trend|progress|so far)|am i (?:losing|gaining) weight)\b/i

export const logIntent = (text: string): LogIntent | null => {
  const t = text.trim().replace(/[.!]+$/, "").replace(/\s+/g, " ")
  if (!t || t.split(/\s+/).length > MAX_WORDS) return null

  // ---- questions
  if (/\?$|^(?:how|what)\b/i.test(t) || /^(?:average sleep|my weight|weight (?:trend|progress))/i.test(t)) {
    const bare = t.replace(/\?+$/, "").trim()
    if (ASK_SLEEP.test(bare)) return { kind: "ASK", series: "sleep", period: takePeriod(bare).period, label: null }
    if (ASK_WEIGHT.test(bare)) return { kind: "ASK", series: "weight", period: takePeriod(bare).period, label: null }
    const { period, rest } = takePeriod(bare)
    const m = rest.match(ASK_SPEND) ?? rest.match(ASK_SPEND_TOTAL)
    if (m) {
      const on = (m[1] ?? "").match(/\b(?:on|for)\s+(.{2,40})$/i)
      return { kind: "ASK", series: "money", period, label: tidyLabel(on?.[1]) }
    }
  }

  // ---- counts: "+1 water", "drank 2 glasses of water"
  const plus = t.match(COUNT_PLUS)
  if (plus) return { kind: "COUNT", n: Number(plus[1]), what: plus[2]!.trim() }
  const after = t.match(COUNT_PLUS_AFTER)
  if (after) return { kind: "COUNT", n: Number(after[2]), what: after[1]!.trim() }
  const one = t.match(COUNT_ONE)
  if (one) return { kind: "COUNT", n: 1, what: one[1]!.trim() }
  const verb = t.match(COUNT_VERB)
  if (verb && Number(verb[1]) > 0) return { kind: "COUNT", n: Number(verb[1]), what: verb[2]!.trim() }

  // ---- entries
  const dayOffset: 0 | -1 = /\byesterday\b/i.test(t) ? -1 : 0
  const body = t.replace(/\b(?:yesterday|today)\b/gi, " ").replace(/\s+/g, " ").trim()

  const sleep = body.match(SLEEP) ?? body.match(SLEEP_GOT)
  if (sleep) {
    const v = Number(sleep[1])
    if (v > 0 && v <= 16) return { kind: "ENTRY", series: "sleep", value: v, unit: UNITS.sleep, label: null, dayOffset }
  }
  const weight = body.match(WEIGHT) ?? body.match(WEIGH)
  if (weight) {
    const v = Number(weight[1])
    if (v >= 25 && v <= 300) return { kind: "ENTRY", series: "weight", value: v, unit: UNITS.weight, label: null, dayOffset }
  }
  const spend = body.match(SPEND) ?? body.match(SPEND_SHORT)
  if (spend) {
    const tail = (spend[2] ?? "").trim()
    // "spent 2 hours on DSA" is time, not money (the quick parser takes it first).
    if (TIME_WORD.test(tail)) return null
    const v = num(spend[1]!)
    if (v > 0 && v <= 10_000_000) return { kind: "ENTRY", series: "money", value: v, unit: UNITS.money, label: tidyLabel(tail), dayOffset }
  }
  return null
}

// ---- matching a count to the person's count habits ---------------------------

const COUNT_FILLER = new Set(["glass", "glasses", "cup", "cups", "bottle", "bottles", "of", "a", "an", "the", "my", "some", "more", "time", "times"])
const stem = (w: string): string => w.replace(/(?:es|s)$/, "")
const tokens = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3).map(stem)

// The one count habit the words point at, or null (then the AI or an ask decides).
export const matchCountHabit = <T extends { id: string; title: string }>(what: string, habits: T[]): T | null => {
  const wanted = tokens(what).filter((w) => !COUNT_FILLER.has(w) && !COUNT_FILLER.has(`${w}s`))
  if (wanted.length === 0) return null
  const scored = habits
    .map((h) => {
      const own = new Set(tokens(h.title))
      return { h, score: wanted.filter((w) => own.has(w)).length }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  if (scored.length === 0) return null
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score) return null // ambiguous
  return scored[0]!.h
}

// ---- categories (read at question time, so the Log keeps the raw words) -------

const CATEGORIES: Record<string, string[]> = {
  food: ["lunch", "dinner", "breakfast", "snack", "snacks", "coffee", "tea", "chai", "groceries", "grocery", "restaurant", "zomato", "swiggy", "food", "eating out", "juice", "milk", "fruit", "fruits", "vegetables"],
  transport: ["uber", "ola", "rapido", "auto", "cab", "taxi", "petrol", "fuel", "metro", "bus", "train", "parking", "toll"],
  subscriptions: ["netflix", "spotify", "prime", "hotstar", "youtube premium", "subscription", "icloud", "chatgpt"],
  bills: ["rent", "electricity", "wifi", "internet", "recharge", "phone bill", "water bill", "gas", "emi"],
}

export const categoryOf = (label: string | null): string => {
  if (!label) return "other"
  const l = label.toLowerCase()
  for (const [cat, words] of Object.entries(CATEGORIES)) {
    if (words.some((w) => l === w || l.includes(w))) return cat
  }
  return "other"
}

// Does an entry's label belong to what was asked ("food", "lunch")?
const labelMatches = (rowLabel: string | null, asked: string): boolean => {
  const a = asked.toLowerCase()
  const l = (rowLabel ?? "").toLowerCase()
  return categoryOf(rowLabel) === a || l.includes(a) || (l.length > 0 && a.includes(l))
}

// ---- periods -------------------------------------------------------------------

const ymd = (d: Date): string => d.toISOString().slice(0, 10)
const day = (key: string): Date => new Date(`${key}T00:00:00.000Z`)
const addDays = (key: string, n: number): string => ymd(new Date(day(key).getTime() + n * 86_400_000))

// Inclusive day keys. The week starts on Monday.
export const periodRange = (period: LogPeriod, todayKey: string): { from: string; to: string } => {
  const d = day(todayKey)
  switch (period) {
    case "TODAY":
      return { from: todayKey, to: todayKey }
    case "YESTERDAY":
      return { from: addDays(todayKey, -1), to: addDays(todayKey, -1) }
    case "LAST_7":
      return { from: addDays(todayKey, -6), to: todayKey }
    case "WEEK":
      return { from: addDays(todayKey, -((d.getUTCDay() + 6) % 7)), to: todayKey }
    case "MONTH":
      return { from: `${todayKey.slice(0, 7)}-01`, to: todayKey }
    case "LAST_MONTH": {
      const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))
      return { from: ymd(first), to: ymd(last) }
    }
  }
}

export const periodWords = (p: LogPeriod): string =>
  ({ TODAY: "today", YESTERDAY: "yesterday", WEEK: "this week", LAST_7: "in the last 7 days", MONTH: "this month", LAST_MONTH: "last month" })[p]

// Sleep and weight are one number a day: the latest entry of the day wins.
export const latestPerDay = (rows: LogRow[]): LogRow[] => {
  const byDay = new Map<string, LogRow>()
  for (const r of rows) {
    const cur = byDay.get(r.date)
    if (!cur || r.createdAt.getTime() >= cur.createdAt.getTime()) byDay.set(r.date, r)
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// ---- words ---------------------------------------------------------------------

const inr = (n: number): string => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n))}`
const dec = (n: number): string => (Math.round(n * 10) / 10).toString()

export const entryReceipt = (e: { series: LogSeries; value: number; label: string | null }, monthTotal?: number): string => {
  if (e.series === "money") {
    const base = `Logged ${inr(e.value)}${e.label ? ` for ${e.label}` : ""}.`
    return monthTotal !== undefined ? `${base} ${inr(monthTotal)} this month so far.` : base
  }
  if (e.series === "sleep") return `Logged ${dec(e.value)} h of sleep.`
  return `Logged your weight: ${dec(e.value)} kg.`
}

export const answerSpend = (rows: LogRow[], period: LogPeriod, label: string | null): string => {
  const picked = label ? rows.filter((r) => labelMatches(r.label, label)) : rows
  const where = `${label ? ` on ${label}` : ""} ${periodWords(period)}`
  if (picked.length === 0) return `Nothing logged${where}.`
  const total = picked.reduce((s, r) => s + r.value, 0)
  const head = `You spent ${inr(total)}${where}, across ${picked.length} ${picked.length === 1 ? "entry" : "entries"}.`
  if (label) return head
  const by = new Map<string, number>()
  for (const r of picked) by.set(categoryOf(r.label), (by.get(categoryOf(r.label)) ?? 0) + r.value)
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return top.length > 1 ? `${head} Most went on ${top.map(([c, v]) => `${c} (${inr(v)})`).join(", ")}.` : head
}

export const answerSleep = (rows: LogRow[], period: LogPeriod): string => {
  const days = latestPerDay(rows)
  if (days.length === 0) return `No sleep logged ${periodWords(period)}. Tell me "slept 7 hours" and I'll keep track.`
  const avg = days.reduce((s, r) => s + r.value, 0) / days.length
  const last = days[days.length - 1]!
  const nights = `${days.length} ${days.length === 1 ? "night" : "nights"}`
  return days.length === 1
    ? `You logged ${dec(last.value)} h ${periodWords(period)}.`
    : `Your average ${periodWords(period)} is ${dec(avg)} h over ${nights}. The latest was ${dec(last.value)} h.`
}

export const answerWeight = (rows: LogRow[]): string => {
  const days = latestPerDay(rows)
  if (days.length === 0) return `No weight logged yet. Tell me "weight 74" and I'll keep track.`
  const last = days[days.length - 1]!
  const first = days[0]!
  if (days.length === 1) return `Your weight is ${dec(last.value)} kg (${last.date}).`
  const diff = Math.round((last.value - first.value) * 10) / 10
  const move = diff === 0 ? "unchanged" : `${diff < 0 ? "down" : "up"} ${dec(Math.abs(diff))} kg`
  return `Your weight is ${dec(last.value)} kg, ${move} since ${first.date} (${days.length} readings).`
}
