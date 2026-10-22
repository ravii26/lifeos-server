/* =====================================================================
   Common phrases understood by code, before any AI is called (plan 16
   §9b): faster, free, and always the same answer.
   - "30 min English", "applied to 2 jobs", "solved 3 problems" → logged
     on the matching weekly target.
   - "meeting till 4", "busy for an hour", "I'm free now" → busy until.
   Anything not clearly one of these goes to the AI as before.
   ===================================================================== */

export type QuickIntent =
  | { kind: "LOG"; minutes?: number; count?: number; what: string }
  | { kind: "BUSY"; until: string | null } // HH:mm today, null = clear
  // "Remind me to call mom tomorrow at 9 am" / "… every day at 9 am": the
  // exact phrases the app's starters send, so they never depend on the AI.
  | { kind: "REMIND"; text: string; day: "TODAY" | "TOMORROW" | "DAILY"; time: string }

const MAX_WORDS = 9

// "30 min of English", "1.5 hours DSA", "45 minutes on system design"
const MINUTES = /^(?:i\s+)?(?:did|do|practi[sc]ed|studied|spent|worked on|finished)?\s*(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hours?|hrs?|h)\b\s*(?:of|on|for)?\s*(.{2,60})$/i
// "applied to 2 jobs", "solved 3 problems", "made 5 calls"
const COUNT = /^(?:i\s+)?(?:applied (?:to|for)|sent|made|did|solved|finished|completed|called|wrote|read|practi[sc]ed)\s+(\d{1,3})\s+(.{2,60})$/i

const BUSY_UNTIL = /\b(meeting|call|class|lecture|interview|busy|stuck|out)\b[^0-9]*?\b(?:till|until|upto|up to|to)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i
const BUSY_FOR = /\b(meeting|call|class|lecture|interview|busy|stuck|out)\b.*?\bfor\s+(an?|one|1|2|two|3|three|\d{2,3})\s*(hours?|hrs?|h|minutes?|mins?)\b/i
const FREE_NOW = /^(?:ok(?:ay)?[, ]+)?(?:i'?m|i am)\s+(?:free|done|back)(?:\s+now)?\b|^(?:the\s+)?(?:meeting|call|class)\s+(?:is\s+)?(?:over|done|finished)\b/i

const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3 } as Record<string, number>

// Only with am/pm: "at 9" alone is left to the AI, which knows the context.
const REMIND = /^remind me to (.{2,150}?) (today|tomorrow|every ?day|daily) at (\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)$/i

const pad = (n: number) => String(n).padStart(2, "0")

export const quickIntent = (text: string, nowMin: number): QuickIntent | null => {
  const t = text.trim().replace(/[.!]+$/, "")
  const r = t.match(REMIND)
  if (r) {
    let h = Number(r[3])
    const m = Number(r[4] ?? 0)
    const pm = r[5]!.toLowerCase() === "pm"
    if (h >= 1 && h <= 12 && m <= 59) {
      if (pm && h < 12) h += 12
      if (!pm && h === 12) h = 0
      const day = /^tod/i.test(r[2]!) ? "TODAY" : /^tom/i.test(r[2]!) ? "TOMORROW" : "DAILY"
      return { kind: "REMIND", text: r[1]!.trim(), day, time: `${pad(h)}:${pad(m)}` }
    }
  }
  if (!t || t.split(/\s+/).length > 14) return null

  if (FREE_NOW.test(t)) return { kind: "BUSY", until: null }
  const u = t.match(BUSY_UNTIL)
  if (u) {
    let h = Number(u[2])
    const m = Number(u[3] ?? 0)
    const ampm = u[4]?.toLowerCase()
    if (ampm === "pm" && h < 12) h += 12
    if (ampm === "am" && h === 12) h = 0
    // "till 4" during the day means 4 pm, not 4 am.
    if (!ampm && h < 12 && h * 60 + m <= nowMin) h += 12
    if (h <= 23 && m <= 59 && h * 60 + m > nowMin) return { kind: "BUSY", until: `${pad(h)}:${pad(m)}` }
  }
  const f = t.match(BUSY_FOR)
  if (f) {
    const n = WORDS[f[2]!.toLowerCase()] ?? Number(f[2])
    const minutes = /^h/i.test(f[3]!) ? n * 60 : n
    const end = nowMin + minutes
    if (minutes > 0 && end < 24 * 60) return { kind: "BUSY", until: `${pad(Math.floor(end / 60))}:${pad(end % 60)}` }
  }

  if (t.split(/\s+/).length > MAX_WORDS) return null
  const mm = t.match(MINUTES)
  if (mm) {
    const n = Number(mm[1])
    const minutes = /^h/i.test(mm[2]!) ? Math.round(n * 60) : Math.round(n)
    if (minutes > 0 && minutes <= 600) return { kind: "LOG", minutes, what: mm[3]!.trim() }
  }
  const cc = t.match(COUNT)
  if (cc) {
    const count = Number(cc[1])
    if (count > 0) return { kind: "LOG", count, what: `${t.match(/applied/i) ? "applications " : ""}${cc[2]!.trim()}` }
  }
  return null
}

// ---- which weekly target "English" or "2 jobs" means ---------------------------

const STOP = new Set(["the", "a", "an", "of", "on", "for", "to", "my", "some", "more", "and", "with", "today", "now"])
const keys = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.slice(0, 4)) // "applied" ~ "applications", "problems" ~ "problem"

export interface TargetOption {
  id: string
  title: string
  countUnit: string | null
  unit: "min" | "count"
}

// The one target the words point to, or null when none or several fit.
export const matchTarget = (what: string, unit: "min" | "count", targets: TargetOption[]): TargetOption | null => {
  const want = new Set(keys(what))
  if (!want.size) return null
  const scored = targets
    .filter((t) => t.unit === unit)
    .map((t) => ({ t, hits: keys(`${t.title} ${t.countUnit ?? ""}`).filter((k) => want.has(k)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
  if (!scored.length || (scored[1] && scored[1].hits === scored[0]!.hits)) return null
  return scored[0]!.t
}
