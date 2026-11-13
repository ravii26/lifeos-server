/* =====================================================================
   Season changes said in chat, understood by code (free, instant, always
   the same): "park money until March", "park guitar for 2 months",
   "make English my focus". Pure; season.chat.ts acts on the result.
   Anything that does not clearly name one of these returns null, so the
   other handlers (and the AI) still decide.
   ===================================================================== */

export type SeasonIntent =
  | { kind: "PARK"; name: string; when: string | null }
  | { kind: "FOCUS"; name: string; instead?: string }

const PARK = /^(?:please\s+)?park\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:until|till|til|for|to)\s+(.+?))?[.!]?$/i
// The answer to "which one makes room?" (sent by the app's button): the other one is parked.
const FOCUS_SWAP = /^(?:please\s+)?make\s+(?:my\s+|the\s+)?(.+?)\s+(?:a\s+|my\s+|the\s+)?(?:main\s+)?focus\s+instead\s+of\s+(?:my\s+|the\s+)?(.+?)[.!]?$/i
const FOCUS = /^(?:please\s+)?make\s+(?:my\s+|the\s+)?(.+?)\s+(?:a\s+|my\s+|the\s+)?(?:main\s+)?focus(?:\s+(?:now|this season))?[.!]?$/i

const clean = (s: string) => s.replace(/\b(area|goal|stuff|things)\b/gi, "").replace(/\s+/g, " ").trim()

export const seasonIntent = (text: string): SeasonIntent | null => {
  const t = text.trim()
  if (t.split(/\s+/).length > 12) return null
  const p = t.match(PARK)
  if (p && clean(p[1]!)) return { kind: "PARK", name: clean(p[1]!), when: p[2]?.trim() ?? null }
  const s = t.match(FOCUS_SWAP)
  if (s && clean(s[1]!) && clean(s[2]!)) return { kind: "FOCUS", name: clean(s[1]!), instead: clean(s[2]!) }
  const f = t.match(FOCUS)
  if (f && clean(f[1]!)) return { kind: "FOCUS", name: clean(f[1]!) }
  return null
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12 }

const key = (d: Date) => d.toISOString().slice(0, 10)
const fromKey = (k: string) => new Date(`${k}T00:00:00Z`)

// When a parked area comes back. "March" is the 1st of the next March;
// "2 months", "3 weeks", "next month" count from today. Words Ally can't
// turn into a date ("after the switch") return null: parked with no date,
// brought back by asking or at the season review.
export const returnDate = (when: string | null, todayKey: string): string | null => {
  if (!when) return null
  const w = when.toLowerCase().trim()
  const today = fromKey(todayKey)
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}[a-z]*\\b`).test(w))
  if (month >= 0) {
    const y = today.getUTCFullYear() + (month <= today.getUTCMonth() ? 1 : 0)
    return key(new Date(Date.UTC(y, month, 1)))
  }
  if (/\bnext month\b/.test(w)) return key(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)))
  if (/\bnext week\b/.test(w)) return key(new Date(today.getTime() + 7 * 86_400_000))
  const n = w.match(/\b(\d{1,2}|an?|one|two|three|four|five|six|eight|ten|twelve)\s+(day|week|month)s?\b/)
  if (n) {
    const count = /^\d/.test(n[1]!) ? Number(n[1]) : COUNT[n[1]!]!
    if (n[2] === "day") return key(new Date(today.getTime() + count * 86_400_000))
    if (n[2] === "week") return key(new Date(today.getTime() + count * 7 * 86_400_000))
    const d = new Date(today)
    d.setUTCMonth(d.getUTCMonth() + count)
    return key(d)
  }
  return null
}

// Which of the person's areas the words mean: an exact name first, then a
// name containing the words (or the other way round). Several = ask.
export const matchAreas = <T extends { name: string }>(name: string, areas: T[]): T[] => {
  const n = name.toLowerCase().trim()
  const exact = areas.filter((a) => a.name.toLowerCase().trim() === n)
  if (exact.length) return exact
  return areas.filter((a) => {
    const an = a.name.toLowerCase()
    return an.includes(n) || n.includes(an.split(/[:,(]/)[0]!.trim())
  })
}
