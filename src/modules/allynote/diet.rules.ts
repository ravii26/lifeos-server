/* =====================================================================
   Diet and meals (Phase D slice D3, ADR 0040), decided by code, no AI:
   "Monday diet: oats and eggs for breakfast, dal rice for lunch",
   "every day breakfast: oats", "what's for lunch?", "show my diet",
   "shopping list from my diet" (the one AI call, only when asked, lives in
   the service). The plan is one ROUTINE note (collection "Diet") whose
   `meta` holds { days: { "1": { breakfast: "oats" }, all: { ... } } },
   weekday 0 = Sunday. A day-specific meal wins over "all".
   ===================================================================== */

export type Meal = "breakfast" | "lunch" | "snack" | "dinner"
export const MEALS: Meal[] = ["breakfast", "lunch", "snack", "dinner"]

export type DayKey = "all" | "0" | "1" | "2" | "3" | "4" | "5" | "6"
export type DietMeta = { days: Partial<Record<DayKey, Partial<Record<Meal, string>>>> }

export type DietIntent =
  | { kind: "SET"; days: DayKey[]; meals: Partial<Record<Meal, string>> }
  | { kind: "ASK"; day: "TODAY" | "TOMORROW" | number; meal: Meal | null }
  | { kind: "SHOW" }
  | { kind: "SHOPPING" }

const MAX_WORDS = 40
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const DAY_RE = "(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|every ?day|daily|weekdays?|weekends?)(?:s)?"
const MEAL_RE = "(breakfast|lunch|dinner|snacks?|brunch)"

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim()

export const dayKeys = (word: string): DayKey[] | null => {
  const w = norm(word).replace(/s$/, "")
  if (/^every ?day$|^daily$/.test(w)) return ["all"]
  if (w === "weekday") return ["1", "2", "3", "4", "5"]
  if (w === "weekend") return ["0", "6"]
  const i = DAY_NAMES.findIndex((d) => d.startsWith(w.slice(0, 3)) && w.length >= 3)
  return i >= 0 ? [String(i) as DayKey] : null
}

const mealKey = (word: string): Meal => {
  const w = norm(word).replace(/s$/, "")
  return w === "brunch" ? "lunch" : (w as Meal)
}

const clean = (s: string): string => s.replace(/^\s*(?:and|then|,|;|-)\s+/i, "").replace(/[\s,;.]+$/g, "").trim()

// "breakfast: oats, eggs; lunch: dal rice"  or  "oats and eggs for breakfast, dal rice for lunch"
export const parseMeals = (body: string): Partial<Record<Meal, string>> => {
  const out: Partial<Record<Meal, string>> = {}
  const keyed = body.split(new RegExp(`${MEAL_RE}\\s*[:=-]\\s*`, "i"))
  if (keyed.length > 2) {
    for (let i = 1; i + 1 < keyed.length; i += 2) {
      const text = clean(keyed[i + 1]!)
      if (text) out[mealKey(keyed[i]!)] = text.slice(0, 200)
    }
    return out
  }
  const re = new RegExp(`(.+?)\\s+for\\s+${MEAL_RE}\\b(?:\\s*[,;.]\\s*|\\s+and\\s+|$)`, "gi")
  for (const m of body.matchAll(re)) {
    const text = clean(m[1]!)
    if (text) out[mealKey(m[2]!)] = text.slice(0, 200)
  }
  return out
}

const SET_DAY_FIRST = new RegExp(`^(?:my\\s+)?${DAY_RE}(?:'s)?\\s+(?:diet|meals?|menu|diet plan)\\s*[:=-]\\s*(.+)$`, "i")
const SET_DIET_FIRST = new RegExp(`^(?:my\\s+)?(?:diet|meals?|menu|diet plan)\\s+(?:for\\s+|on\\s+)?${DAY_RE}\\s*[:=-]\\s*(.+)$`, "i")
const SET_ONE_MEAL = new RegExp(`^${DAY_RE}(?:'s)?\\s+${MEAL_RE}\\s*(?:is|are|will be|:|=|-)\\s*(.+)$`, "i")
const SET_MEAL_ON = new RegExp(`^(?:set\\s+)?(?:my\\s+)?${MEAL_RE}\\s+(?:on|for)\\s+${DAY_RE}\\s*(?:is|to|:|=|-)\\s*(.+)$`, "i")

const ASK_FOR = new RegExp(`^what(?:'s| is| should i have| should i eat| do i have| am i having)?(?: for)?\\s*${MEAL_RE}?\\s*(today|tomorrow|tonight|on ${DAY_RE}|${DAY_RE})?$`, "i")
const ASK_EAT = new RegExp(`^what\\s+(?:should|do|am|shall)\\s+i\\s+(?:eat|have|be eating|be having)(?:\\s+(?:for\\s+)?${MEAL_RE})?(?:\\s+(today|tomorrow|tonight|on ${DAY_RE}))?$`, "i")
const ASK_DIET = new RegExp(`^what(?:'s| is) (?:my )?(?:diet|menu|meals?)(?: plan)?(?: for| on)? ?(today|tomorrow|${DAY_RE})?$`, "i")
const SHOW = /^(?:show|see|open)\s+(?:me\s+)?(?:my\s+)?(?:diet|diet plan|meal plan|menu)$/i
const SHOPPING = /^(?:make|build|create|get|give)\s+(?:me\s+)?(?:a\s+|the\s+)?(?:shopping|grocery|groceries)(?:\s+list)?\s+(?:from|for|out of|using)\s+(?:my\s+|this week'?s?\s+|the\s+week'?s?\s+|the\s+)?(?:diet|meal plan|meals|menu)(?:\s+plan)?(?:\s+for (?:the |this )week)?$|^(?:shopping|grocery|groceries)(?:\s+list)?\s+(?:from|for)\s+(?:my\s+|this week'?s?\s+|the\s+week'?s?\s+)?(?:diet|meal plan|meals|menu)$|^groceries for (?:this |the )?week'?s?(?: diet| meals)?$/i

export const dietIntent = (text: string): DietIntent | null => {
  const t = text.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ")
  if (!t || t.split(/\s+/).length > MAX_WORDS) return null

  if (SHOPPING.test(t)) return { kind: "SHOPPING" }
  if (SHOW.test(t)) return { kind: "SHOW" }

  const first = t.match(SET_DAY_FIRST)
  const second = t.match(SET_DIET_FIRST)
  const dm = first ? { day: first[1]!, body: first[2]! } : second ? { day: second[1]!, body: second[2]! } : null
  if (dm) {
    const days = dayKeys(dm.day)
    const meals = parseMeals(dm.body)
    if (days && Object.keys(meals).length) return { kind: "SET", days, meals }
  }
  const one = t.match(SET_ONE_MEAL)
  if (one) {
    const days = dayKeys(one[1]!)
    const text1 = clean(one[3]!)
    if (days && text1) return { kind: "SET", days, meals: { [mealKey(one[2]!)]: text1.slice(0, 200) } }
  }
  const on = t.match(SET_MEAL_ON)
  if (on) {
    const days = dayKeys(on[2]!)
    const text1 = clean(on[3]!)
    if (days && text1) return { kind: "SET", days, meals: { [mealKey(on[1]!)]: text1.slice(0, 200) } }
  }

  const dietQ = t.match(ASK_DIET)
  if (dietQ) return { kind: "ASK", day: askDay(dietQ[1]), meal: null }
  const eat = t.match(ASK_EAT)
  if (eat) return { kind: "ASK", day: askDay(eat[2]), meal: eat[1] ? mealKey(eat[1]) : null }
  const forQ = t.match(ASK_FOR)
  if (forQ && (forQ[1] || /^what(?:'s| is)? ?(?:for )?(?:dinner|lunch|breakfast|snacks?)/i.test(t))) {
    return { kind: "ASK", day: askDay(forQ[2]), meal: forQ[1] ? mealKey(forQ[1]) : null }
  }
  return null
}

const askDay = (w: string | undefined): "TODAY" | "TOMORROW" | number => {
  if (!w) return "TODAY"
  const s = norm(w).replace(/^on /, "")
  if (s === "tomorrow") return "TOMORROW"
  if (s === "today" || s === "tonight") return "TODAY"
  const k = dayKeys(s)
  return k && k[0] !== "all" ? Number(k[0]) : "TODAY"
}

// ---- reading the plan ---------------------------------------------------------------------

export const mealFor = (meta: DietMeta | null | undefined, weekday: number, meal: Meal): string | null =>
  meta?.days?.[String(weekday) as DayKey]?.[meal] ?? meta?.days?.all?.[meal] ?? null

export const mealsOf = (meta: DietMeta | null | undefined, weekday: number): Partial<Record<Meal, string>> => {
  const out: Partial<Record<Meal, string>> = {}
  for (const m of MEALS) {
    const v = mealFor(meta, weekday, m)
    if (v) out[m] = v
  }
  return out
}

// Which meal is next at this hour (24h): the one being eaten or coming up.
export const nextMealAt = (hour: number): Meal => (hour < 10 ? "breakfast" : hour < 15 ? "lunch" : hour < 18 ? "snack" : hour < 22 ? "dinner" : "breakfast")

// Merge new meals into the plan without losing the other meals or days.
export const mergeDiet = (meta: DietMeta | null | undefined, days: DayKey[], meals: Partial<Record<Meal, string>>): DietMeta => {
  const next: DietMeta = { days: { ...(meta?.days ?? {}) } }
  for (const d of days) next.days[d] = { ...(next.days[d] ?? {}), ...meals }
  return next
}

export const isDietMeta = (v: unknown): v is DietMeta => !!v && typeof v === "object" && typeof (v as DietMeta).days === "object" && (v as DietMeta).days !== null

// ---- words ---------------------------------------------------------------------------------

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const dayName = (k: DayKey): string => (k === "all" ? "Every day" : cap(DAY_NAMES[Number(k)]!))
const list = (m: Partial<Record<Meal, string>>): string => MEALS.filter((x) => m[x]).map((x) => `${x} ${m[x]}`).join("; ")

export const savedReply = (days: DayKey[], meals: Partial<Record<Meal, string>>): string => {
  const who = days.length === 1 ? (days[0] === "all" ? "every day" : `${dayName(days[0]!)}'s`) : days.length === 5 && !days.includes("0") ? "weekday" : days.length === 2 && days.includes("0") ? "weekend" : "those days'"
  return days[0] === "all" && days.length === 1 ? `Saved. Every day: ${list(meals)}.` : `Saved ${who} diet: ${list(meals)}.`
}

export const dayLabel = (day: "TODAY" | "TOMORROW" | number): string => (day === "TODAY" ? "today" : day === "TOMORROW" ? "tomorrow" : `on ${cap(DAY_NAMES[day])}`)

export const askReply = (meta: DietMeta | null, weekday: number, label: string, meal: Meal | null): string => {
  const meals = mealsOf(meta, weekday)
  if (meal) {
    return meals[meal] ? `${cap(meal)} ${label}: ${meals[meal]}.` : `Nothing planned for ${meal} ${label}. Say "${DAY_NAMES[weekday]} ${meal}: ..." to set it.`
  }
  const text = list(meals)
  return text ? `${cap(label)}: ${text}.` : `Nothing planned ${label}. Say "${DAY_NAMES[weekday]} diet: oats and eggs for breakfast, dal rice for lunch" to set it.`
}

export const weekReply = (meta: DietMeta | null): string => {
  if (!meta || !Object.keys(meta.days).length) return 'You haven\'t set a diet yet. Say "Monday diet: oats and eggs for breakfast, dal rice for lunch".'
  const order: DayKey[] = ["all", "1", "2", "3", "4", "5", "6", "0"]
  return order.filter((k) => meta.days[k] && Object.keys(meta.days[k]!).length).map((k) => `${dayName(k)}: ${list(meta.days[k]!)}`).join("\n")
}

// The meal names of the week, for "shopping list from my diet".
export const weekMealTexts = (meta: DietMeta | null | undefined): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const day of Object.values(meta?.days ?? {})) {
    for (const v of Object.values(day ?? {})) {
      if (v && !seen.has(norm(v))) {
        seen.add(norm(v))
        out.push(v)
      }
    }
  }
  return out
}

// Used when no AI is available: the meal names split into items (clearly worse than ingredients).
export const itemsFromMealNames = (texts: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of texts) {
    for (const part of t.split(/\s*(?:,|&|\band\b|\bwith\b|\+)\s*/i)) {
      const p = part.replace(/^(?:a|an|the|some)\s+/i, "").trim()
      if (p.length >= 2 && !seen.has(norm(p))) {
        seen.add(norm(p))
        out.push(cap(p))
      }
    }
  }
  return out.slice(0, 30)
}
