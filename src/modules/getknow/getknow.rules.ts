/* =====================================================================
   "Get to know you" (ADR 0034): Ally starts out knowing nothing about
   the person, so it asks, one short question at a time, from a fixed list.
   No AI is involved: the questions, the order, the cadence and the parsing
   are all code, so it costs nothing and always behaves the same.
   - At most 2 a day, never while sick / away / busy, always skippable.
   - A skipped question comes back after a week, once.
   - Anything Ally already knows is never asked again.
   This file is pure; getknow.service.ts reads and writes the data.
   ===================================================================== */

export type KnowId = "goal" | "wake" | "sleep" | "hours" | "drain" | "style" | "help" | "focus_time" | "health" | "people"

export interface KnowQuestion {
  id: KnowId
  text: string
  why: string // shown small under the question, so it never feels like a form
  options: string[]
  allowText: boolean
  hint?: string
}

export const QUESTIONS: KnowQuestion[] = [
  {
    id: "goal",
    text: "What's the one thing you most want to change or achieve in the next 3 months?",
    why: "So I can plan your days around it.",
    options: [],
    allowText: true,
    hint: "For example: switch jobs, lose 10 kg, speak English well",
  },
  {
    id: "wake",
    text: "What time do you usually wake up?",
    why: "So I never message you while you sleep, and can plan your mornings.",
    options: ["Before 5", "5 to 6", "6 to 7", "7 to 8", "After 8"],
    allowText: true,
    hint: "Or type a time, like 6:30",
  },
  {
    id: "sleep",
    text: "And when do you usually go to sleep?",
    why: "So the evening wrap-up comes at the right time.",
    options: ["Before 10", "10 to 11", "11 to 12", "12 to 1", "After 1"],
    allowText: true,
    hint: "Or type a time, like 11:30",
  },
  {
    id: "hours",
    text: "When do your work or studies usually start and end?",
    why: "So I don't suggest things while you're busy.",
    options: ["9 to 5", "10 to 6", "10 to 8:30", "8 to 2", "I don't have fixed hours"],
    allowText: true,
    hint: "Or type it, like 9 to 6",
  },
  {
    id: "drain",
    text: "What takes more of your time than you'd like?",
    why: "So I can help with the thing that actually costs you.",
    options: ["Reels and scrolling", "YouTube or TV", "Games", "Overthinking or planning", "Putting things off", "Nothing much"],
    allowText: true,
  },
  {
    id: "style",
    text: "How should I talk to you?",
    why: "You can change this any time in You.",
    options: ["Gentle", "Balanced", "Direct"],
    allowText: false,
  },
  {
    id: "help",
    text: "What do you want my help with most?",
    why: "I'll lead with this.",
    options: ["A bit of everything", "Just remembering and reminders", "My goals", "Turning saved videos into steps", "Someone to talk to"],
    allowText: false,
  },
  {
    id: "focus_time",
    text: "When do you think and work best?",
    why: "So I put the hard things there.",
    options: ["Morning", "Afternoon", "Evening", "Late at night"],
    allowText: false,
  },
  {
    id: "health",
    text: "Do you exercise or follow a diet right now?",
    why: "Only so my suggestions fit what you already do.",
    options: ["Exercise regularly", "Sometimes", "Not yet", "I follow a diet plan"],
    allowText: true,
  },
  {
    id: "people",
    text: "Who are the important people in your life I should know about?",
    why: "So I can remember them: names and who they are.",
    options: [],
    allowText: true,
    hint: "For example: Mom, Rahul (best friend), Priya (sister)",
  },
]

export const MAX_PER_DAY = 2
export const SKIP_DAYS = 7

export interface KnowEvent {
  id: KnowId
  at: Date
  skipped: boolean
  value: string // the answer as given (empty when skipped)
}

// What decides the next question. `known` are things Ally already has from elsewhere
// (a day schedule, a goal, settings the person changed).
export interface KnowState {
  events: KnowEvent[] // newest last
  known: Set<KnowId>
  now: Date
  todayStartMs: number // local midnight, so "2 a day" follows the person's day
}

const latest = (events: KnowEvent[], id: KnowId): KnowEvent | undefined => [...events].reverse().find((e) => e.id === id)

export const isAnswered = (s: KnowState, id: KnowId): boolean => s.known.has(id) || (latest(s.events, id) !== undefined && !latest(s.events, id)!.skipped)

export const answeredCount = (s: KnowState): number => QUESTIONS.filter((q) => isAnswered(s, q.id)).length

export const askedToday = (s: KnowState): number => s.events.filter((e) => e.at.getTime() >= s.todayStartMs).length

// The next question to show, or null (nothing left, enough for today, or a skipped one is resting).
export const nextQuestion = (s: KnowState): KnowQuestion | null => {
  if (askedToday(s) >= MAX_PER_DAY) return null
  for (const q of QUESTIONS) {
    if (isAnswered(s, q.id)) continue
    const last = latest(s.events, q.id)
    if (last?.skipped) {
      // Skipped once: rests for a week, then comes back one time. A second skip means never again.
      const skips = s.events.filter((e) => e.id === q.id && e.skipped).length
      if (skips >= 2) continue
      if (s.now.getTime() - last.at.getTime() < SKIP_DAYS * 86_400_000) continue
    }
    return q
  }
  return null
}

// ---- reading what the person typed or tapped -----------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0")
const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`

const WAKE_CHIPS: Record<string, string> = { "before 5": "04:30", "5 to 6": "05:30", "6 to 7": "06:30", "7 to 8": "07:30", "after 8": "08:30" }
const SLEEP_CHIPS: Record<string, string> = { "before 10": "21:30", "10 to 11": "22:30", "11 to 12": "23:30", "12 to 1": "00:30", "after 1": "01:30" }

const clock = /(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i

// "6", "6:30", "6.30 am", "11 pm": a time of day. Without am/pm, a wake time is morning and a bed time is night.
export const parseTime = (text: string, kind: "wake" | "sleep"): string | null => {
  const t = text.trim().toLowerCase()
  const chips = kind === "wake" ? WAKE_CHIPS : SLEEP_CHIPS
  if (chips[t]) return chips[t]!
  const m = t.match(clock)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (h > 24 || min > 59) return null
  const mer = m[3]?.replace(/\./g, "")
  if (mer === "pm" && h < 12) h += 12
  else if (mer === "am" && h === 12) h = 0
  else if (!mer && kind === "sleep") {
    // With no am/pm, a bed time is at night ("11" means 11 pm, "12" is midnight); a wake time stays as typed.
    if (h >= 6 && h <= 11) h += 12
    else if (h === 12) h = 0
  }
  if (h === 24) h = 0
  return hhmm(h, min)
}

export type Hours = { start: string; end: string } | { none: true }

// "9 to 6", "10-8:30", "9am to 5pm", "8 to 2": start and end of the day's fixed commitment.
export const parseHours = (text: string): Hours | null => {
  const t = text.trim().toLowerCase()
  if (/no fixed|don'?t have|none|free|flexible|not working|no work/.test(t)) return { none: true }
  const parts = t.split(/\s*(?:to|till|until|-|–|—)\s*/)
  if (parts.length !== 2) return null
  const a = parts[0]!.match(clock)
  const b = parts[1]!.match(clock)
  if (!a || !b) return null
  let sh = Number(a[1])
  const sm = a[2] ? Number(a[2]) : 0
  let eh = Number(b[1])
  const em = b[2] ? Number(b[2]) : 0
  const sMer = a[3]?.replace(/\./g, "")
  const eMer = b[3]?.replace(/\./g, "")
  if (sh > 23 || eh > 24 || sm > 59 || em > 59) return null
  if (sMer === "pm" && sh < 12) sh += 12
  if (sMer === "am" && sh === 12) sh = 0
  if (eMer === "pm" && eh < 12) eh += 12
  if (eMer === "am" && eh === 12) eh = 0
  // No am/pm on the end: if it would be before the start, it is the afternoon ("9 to 6" is 9am to 6pm, "8 to 2" is 8am to 2pm).
  if (!eMer && eh * 60 + em <= sh * 60 + sm && eh < 12) eh += 12
  // Anything still ending before it starts (a night shift, say) is not something this question handles.
  if (eh * 60 + em <= sh * 60 + sm || eh > 23) return null
  return { start: hhmm(sh, sm), end: hhmm(eh, em) }
}

export const STYLE_BY_CHIP: Record<string, "GENTLE" | "BALANCED" | "DIRECT"> = { gentle: "GENTLE", balanced: "BALANCED", direct: "DIRECT" }
export const HELP_BY_CHIP: Record<string, "ALL" | "REMEMBER" | "GOALS" | "SAVES" | "SUPPORT"> = {
  "a bit of everything": "ALL",
  "just remembering and reminders": "REMEMBER",
  "my goals": "GOALS",
  "turning saved videos into steps": "SAVES",
  "someone to talk to": "SUPPORT",
}

export const questionById = (id: string): KnowQuestion | undefined => QUESTIONS.find((q) => q.id === id)
