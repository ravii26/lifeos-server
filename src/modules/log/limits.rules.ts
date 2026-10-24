/* =====================================================================
   Limits (doc 18 item 5, ADR 0037): "limit Instagram to 1 hour", "no more
   than 2 chai a day", "no sugar". A limit is a habit with a cap (isLimit),
   not something to do: it is never suggested, never reminded. A day counts
   as kept unless more than the cap was logged. Days kept, never a streak,
   never red. Decided by code; anything unclear returns null (the AI).
   ===================================================================== */

export type LimitIntent =
  | { kind: "CREATE"; what: string; per: "TIME" | "COUNT"; max: number } // max = minutes or a count; 0 = none at all
  | { kind: "USE_TIME"; minutes: number; what: string }
  | { kind: "ASK"; what: string | null }

const MAX_WORDS = 14
const TIME_UNIT = "(hours?|hrs?|h|minutes?|mins?)\\b"
const A_DAY = "(?:\\s+(?:a|per|each|every)\\s+day|\\s+daily)"
const THINGS = "(?:cups?|glasses|times|pieces|cigarettes|drinks|slices|cans|bottles|bars|packs?|servings?)"
// "No X" is a limit only for things that are plainly habits to avoid.
const AVOIDED = "sugar|smoking|alcohol|soda|junk food|fast food|sweets|caffeine|cigarettes|vaping|tobacco|snacking|chips|fried food|late night snacks|energy drinks"

const toMinutes = (n: string, unit: string): number => Math.round(Number(n) * (/^h/i.test(unit) ? 60 : 1))

const tidy = (s: string): string =>
  s
    .replace(/^(?:of|on|in|my|the|a|an)\s+/i, "")
    .replace(/^(?:of|on|in|my|the|a|an)\s+/i, "")
    .replace(/[?.!,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

const LIMIT_TO_TIME = new RegExp(`^(?:limit|cap)\\s+(.{2,40}?)\\s+to\\s+(\\d+(?:\\.\\d+)?)\\s*${TIME_UNIT}${A_DAY}?$`, "i")
const LIMIT_TO_COUNT = new RegExp(`^(?:limit|cap)\\s+(.{2,40}?)\\s+to\\s+(\\d{1,3})(?:\\s+${THINGS})?${A_DAY}?$`, "i")
const MAX_TIME = new RegExp(`^(?:max(?:imum)?|at most|no more than|not more than)\\s+(\\d+(?:\\.\\d+)?)\\s*${TIME_UNIT}\\s+(?:of\\s+|on\\s+|in\\s+)?(.{2,40}?)${A_DAY}$`, "i")
const MAX_COUNT = new RegExp(`^(?:max(?:imum)?|at most|no more than|not more than)\\s+(\\d{1,3})\\s+(?:${THINGS}\\s+(?:of\\s+)?)?(.{2,40}?)${A_DAY}$`, "i")
const NEVER = new RegExp(`^(?:no|avoid|quit)\\s+(${AVOIDED})(?:\\s+(?:from now on|today|every day|daily))?$`, "i")

const USED_A = new RegExp(`^(?:i\\s+)?(?:spent|scrolled|watched|wasted|used|was on)\\s+(\\d+(?:\\.\\d+)?)\\s*${TIME_UNIT}\\s*(?:of|on|in|for)?\\s*(.{2,40})$`, "i")
const USED_B = new RegExp(`^(?:i\\s+)?(?:scrolled|watched|used|was on)\\s+(.{2,40}?)\\s+for\\s+(\\d+(?:\\.\\d+)?)\\s*${TIME_UNIT}$`, "i")

const ASK_ONE = /^how(?:'s| is| are)\s+(?:my\s+)?(.{2,30}?)\s+limits?(?:\s+(?:today|this week|going))?$/i
const ASK_ALL = /^(?:how am i doing (?:on|with) (?:my )?limits|am i (?:within|under|inside) (?:my )?limits|(?:show|list|what are) my limits|my limits)$/i

export const limitIntent = (text: string): LimitIntent | null => {
  const t = text.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ")
  if (!t || t.split(/\s+/).length > MAX_WORDS) return null

  const all = t.match(ASK_ALL)
  if (all) return { kind: "ASK", what: null }
  const one = t.match(ASK_ONE)
  if (one) return { kind: "ASK", what: tidy(one[1]!) }

  const lt = t.match(LIMIT_TO_TIME)
  if (lt) return { kind: "CREATE", what: tidy(lt[1]!), per: "TIME", max: toMinutes(lt[2]!, lt[3]!) }
  const mt = t.match(MAX_TIME)
  if (mt) return { kind: "CREATE", what: tidy(mt[3]!), per: "TIME", max: toMinutes(mt[1]!, mt[2]!) }
  const lc = t.match(LIMIT_TO_COUNT)
  if (lc) return { kind: "CREATE", what: tidy(lc[1]!), per: "COUNT", max: Number(lc[2]) }
  const mc = t.match(MAX_COUNT)
  if (mc) return { kind: "CREATE", what: tidy(mc[2]!), per: "COUNT", max: Number(mc[1]) }
  const never = t.match(NEVER)
  if (never) return { kind: "CREATE", what: tidy(never[1]!), per: "COUNT", max: 0 }

  const ua = t.match(USED_A)
  if (ua) return { kind: "USE_TIME", minutes: toMinutes(ua[1]!, ua[2]!), what: tidy(ua[3]!) }
  const ub = t.match(USED_B)
  if (ub) return { kind: "USE_TIME", minutes: toMinutes(ub[2]!, ub[3]!), what: tidy(ub[1]!) }
  return null
}

// ---- days kept ---------------------------------------------------------------------

export interface LimitDay {
  date: string // YYYY-MM-DD, the person's local day
  used: number // minutes or count logged that day
}

const addDays = (key: string, n: number): string => new Date(new Date(`${key}T00:00:00.000Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

export interface LimitStatus {
  usedToday: number
  left: number // 0 when at or past the cap
  over: boolean
  keptDays: number // of the days counted
  counted: number // up to 7, never before the limit was set
}

// A day is kept when what was logged is within the cap (nothing logged = kept).
export const limitStatus = (max: number, logs: LimitDay[], createdKey: string, todayKey: string): LimitStatus => {
  const byDay = new Map<string, number>()
  for (const l of logs) byDay.set(l.date, (byDay.get(l.date) ?? 0) + l.used)
  const usedToday = byDay.get(todayKey) ?? 0
  let counted = 0
  let keptDays = 0
  for (let i = 0; i < 7; i++) {
    const key = addDays(todayKey, -i)
    if (key < createdKey) break
    counted++
    if ((byDay.get(key) ?? 0) <= max) keptDays++
  }
  return { usedToday, left: Math.max(0, max - usedToday), over: usedToday > max, keptDays, counted }
}

// ---- words ---------------------------------------------------------------------------

export const duration = (minutes: number): string => {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export const limitLine = (title: string, per: "TIME" | "COUNT", max: number, s: LimitStatus): string => {
  const name = cap(title)
  const kept = s.counted > 1 ? ` Kept ${s.keptDays} of the last ${s.counted} days.` : ""
  const fresh = s.over ? " Tomorrow starts fresh." : ""
  if (per === "TIME") {
    return s.over
      ? `${name}: ${duration(s.usedToday)} today, past your ${duration(max)}.${kept}${fresh}`
      : `${name}: ${duration(s.usedToday)} of ${duration(max)} today${s.usedToday > 0 ? `, ${duration(s.left)} left` : ""}.${kept}`
  }
  if (max === 0) {
    return s.usedToday === 0 ? `${name}: none so far today.${kept}` : `${name}: ${s.usedToday} today.${kept}${fresh}`
  }
  return s.over
    ? `${name}: ${s.usedToday} today, past your ${max}.${kept}${fresh}`
    : `${name}: ${s.usedToday} of ${max} today${s.usedToday > 0 ? `, ${s.left} left` : ""}.${kept}`
}

export const createdReply = (what: string, per: "TIME" | "COUNT", max: number): string => {
  if (per === "TIME") return `Okay. I'll keep track of ${what}: up to ${duration(max)} a day. Tell me when you've used some ("spent 40 min on ${what}"). I won't remind you; I just count the days you stayed within it.`
  if (max === 0) return `Okay. No ${what}. Tell me if you slip ("had ${what}") and I'll keep count. I just count the days you kept it, and a slip is just a slip.`
  return `Okay. At most ${max} ${what} a day. Say "+1 ${what}" each time and I'll tell you what's left. I count the days you stayed within it.`
}
