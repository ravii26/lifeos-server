/* =====================================================================
   Talking like a person (plan 16 §2, ADR 0027), understood by code:
   - follow-ups about the last thing: "move it to tomorrow", "make that
     30 min", "change it to 9 pm", "undo that";
   - corrections: "no, gym is at 9 not 8";
   - questions answered from real data: "what's my day?", "what's left?",
     "what did I do yesterday?", "am I on track for the interview?";
   - changing a goal plan that was just proposed: "make DSA 4 h".
   "It / that" is the most recent thing Ally just made or touched, sent by
   the app with the history (refs). Anything unclear goes to the AI.
   ===================================================================== */

export type RefType = "TASK" | "HABIT" | "PROJECT" | "NOTE" | "GOAL_PLAN"

export interface ChatRef {
  type: RefType
  id?: string
  title?: string
  activityId?: string
  goalText?: string // GOAL_PLAN: what was asked, so a change can re-plan it
}

export type When = { kind: "TODAY" | "TONIGHT" | "TOMORROW" | "NEXT_WEEK" | "WEEKEND" } | { kind: "WEEKDAY"; weekday: number }

export type FollowUp =
  | { kind: "MOVE"; when: When }
  | { kind: "RESIZE"; minutes: number }
  | { kind: "RETIME"; hour: number; minute: number; ampm: "am" | "pm" | null }
  | { kind: "CORRECT"; what: string; hour: number; minute: number; ampm: "am" | "pm" | null }
  | { kind: "UNDO" }
  | { kind: "DAY" }
  | { kind: "DONE_ON"; day: "TODAY" | "YESTERDAY" }
  | { kind: "ON_TRACK"; what: string | null }
  | { kind: "PLAN_CHANGE" }

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const IT = String.raw`(?:it|that|this|them|those)`
const WHEN = String.raw`(tomorrow|today|tonight|next week|(?:the |this )?weekend|(?:on |next )?(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?)`

const parseWhen = (raw: string): When | null => {
  const w = raw.toLowerCase().replace(/^(on|next|this|the)\s+/, "").trim()
  if (w === "tomorrow") return { kind: "TOMORROW" }
  if (w === "today") return { kind: "TODAY" }
  if (w === "tonight") return { kind: "TONIGHT" }
  if (w === "week") return { kind: "NEXT_WEEK" }
  if (raw.toLowerCase().includes("next week")) return { kind: "NEXT_WEEK" }
  if (w.startsWith("weekend")) return { kind: "WEEKEND" }
  const i = WEEKDAYS.findIndex((d) => d.startsWith(w.slice(0, 3)))
  return i >= 0 ? { kind: "WEEKDAY", weekday: i } : null
}

const MOVE = new RegExp(String.raw`^(?:ok(?:ay)?[, ]+)?(?:please\s+)?(?:move|push|shift|postpone|reschedule|do)\s+${IT}\s+(?:to\s+|for\s+|on\s+)?${WHEN}$`, "i")
const RESIZE = new RegExp(String.raw`^(?:ok(?:ay)?[, ]+)?(?:make|change|set|keep)\s+${IT}\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hours?|hrs?|h)$`, "i")
const RETIME = new RegExp(String.raw`^(?:ok(?:ay)?[, ]+|no[, ]+)?(?:make|change|move|set|shift)\s+${IT}\s+(?:to\s+)?(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$`, "i")
const INSTEAD = /^(?:no[, ]+)?(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s+instead$/i
const CORRECT = /^no[, ]+(?:my\s+)?(.{2,40}?)\s+(?:is|should be|happens)\s+at\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?(?:[, ]+not\b.*)?$/i
const UNDO = new RegExp(String.raw`^(?:undo|undo ${IT}|cancel ${IT}|delete ${IT}|remove ${IT}|scrap ${IT}|forget ${IT})$`, "i")
const DAY = /^(?:so\s+)?(?:what'?s|what is|show(?: me)?|tell me)\s+(?:my day|my plan(?: for today)?|on (?:for )?today|planned (?:for )?today|left(?: for today| today)?|next|my schedule(?: today)?)\b|^what (?:do i|should i) (?:have|do) (?:left )?today\b|^plan for today$|^what'?s left\b/i
const DONE_ON = /\bwhat (?:did|have) i (?:do|done|get done|finish|finished|complete|completed)\s+(today|yesterday)\b/i
const ON_TRACK = /\b(?:am i on track|am i behind|how am i doing|how'?s my progress)(?:\s+(?:for|with|on)\s+(?:the\s+|my\s+)?(.{2,40}?))?\??$/i
// Changing a plan that was just proposed: short, starts like an edit.
const PLAN_EDIT = /^(?:make|keep|change|only|just|less|more|reduce|increase|add|remove|drop|without|no |skip|move|put|i (?:can'?t|cannot|only|prefer|want))\b/i

const ampmOf = (v: string | undefined): "am" | "pm" | null => (v ? (v.toLowerCase() as "am" | "pm") : null)

export const followUpIntent = (text: string, hasPlanRef = false): FollowUp | null => {
  const t = text.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ")
  if (!t || t.split(" ").length > 16) return null

  if (UNDO.test(t)) return { kind: "UNDO" }
  const mv = t.match(MOVE)
  if (mv) {
    const when = parseWhen(mv[1]!)
    if (when) return { kind: "MOVE", when }
  }
  const rs = t.match(RESIZE)
  if (rs) {
    const n = Number(rs[1])
    const minutes = /^h/i.test(rs[2]!) ? Math.round(n * 60) : Math.round(n)
    if (minutes > 0 && minutes <= 600) return { kind: "RESIZE", minutes }
  }
  const rt = t.match(RETIME) ?? t.match(INSTEAD)
  if (rt) {
    const hour = Number(rt[1])
    const minute = Number(rt[2] ?? 0)
    if (hour <= 23 && minute <= 59) return { kind: "RETIME", hour, minute, ampm: ampmOf(rt[3]) }
  }
  const co = t.match(CORRECT)
  if (co) {
    const hour = Number(co[2])
    const minute = Number(co[3] ?? 0)
    if (hour <= 23 && minute <= 59) return { kind: "CORRECT", what: co[1]!.trim(), hour, minute, ampm: ampmOf(co[4]) }
  }
  if (DAY.test(t)) return { kind: "DAY" }
  const dn = t.match(DONE_ON)
  if (dn) return { kind: "DONE_ON", day: dn[1]!.toLowerCase() === "yesterday" ? "YESTERDAY" : "TODAY" }
  const ot = (text.trim().replace(/\s+/g, " ")).match(ON_TRACK)
  if (ot) return { kind: "ON_TRACK", what: ot[1]?.trim() || null }
  if (hasPlanRef && PLAN_EDIT.test(t)) return { kind: "PLAN_CHANGE" }
  return null
}

// "9" said in the evening about a reminder means 9 pm; with am/pm it's exact.
export const resolveHour = (hour: number, ampm: "am" | "pm" | null, nowMin: number, preferPm = false): number => {
  if (ampm === "pm" && hour < 12) return hour + 12
  if (ampm === "am" && hour === 12) return 0
  if (ampm || hour >= 13 || hour === 0) return hour
  // No am/pm: 1–6 is almost always afternoon/evening; otherwise pick the next one ahead.
  if (hour <= 6) return hour + 12
  if (preferPm && hour < 12) return hour + 12
  return hour * 60 <= nowMin && hour + 12 <= 23 ? hour + 12 : hour
}

// The day a "when" lands on, from today (weekday 0 = Sunday).
export const daysAhead = (when: When, weekday: number): number => {
  switch (when.kind) {
    case "TODAY":
    case "TONIGHT":
      return 0
    case "TOMORROW":
      return 1
    case "NEXT_WEEK":
      return ((8 - weekday) % 7) || 7 // next Monday
    case "WEEKEND":
      return weekday === 6 ? 1 : (6 - weekday + 7) % 7 // the coming Saturday (on Saturday: tomorrow)
    case "WEEKDAY":
      return ((when.weekday - weekday + 7) % 7) || 7
  }
}

// The thing "it" means: the newest ref of a kind that can do this, from the
// last few assistant turns.
export const lastRef = (turns: { role: string; refs?: ChatRef[] }[], allow: RefType[]): ChatRef | null => {
  let seen = 0
  for (let i = turns.length - 1; i >= 0 && seen < 3; i--) {
    const t = turns[i]!
    if (t.role !== "assistant") continue
    seen++
    const r = [...(t.refs ?? [])].reverse().find((x) => allow.includes(x.type))
    if (r) return r
  }
  return null
}

const STOP = new Set(["the", "my", "a", "an", "is", "at", "to", "for", "and", "of"])
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w))

// "gym" → the habit "Gym session"; null when nothing or several match equally.
export const matchByTitle = <T extends { title: string }>(what: string, items: T[]): T | null => {
  const want = words(what)
  if (!want.length) return null
  const scored = items
    .map((it) => ({ it, hits: words(it.title).filter((w) => want.some((x) => w.startsWith(x.slice(0, 4)) || x.startsWith(w.slice(0, 4)))).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
  if (!scored.length || (scored[1] && scored[1].hits === scored[0]!.hits)) return null
  return scored[0]!.it
}
