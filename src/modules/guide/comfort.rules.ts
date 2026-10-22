/* =====================================================================
   Comfort: when someone says how they feel, what did they save for exactly
   that? Pure matching (no AI): feelings are mapped to a small vocabulary,
   and the shelf item that was least used for it comes back first, so the
   same video does not appear every time.
   ===================================================================== */

export const FEELING_WORDS: Record<string, string[]> = {
  lazy: ["lazy", "laziness", "cant be bothered", "can't be bothered", "procrastinat", "couch", "aalas", "alas"],
  low: ["low", "down", "depressed", "blue", "empty", "numb", "hopeless"],
  sad: ["sad", "crying", "cry", "heartbroken", "upset", "grief"],
  anxious: ["anxious", "anxiety", "nervous", "panic", "worried", "worry", "scared", "afraid"],
  stressed: ["stressed", "stress", "overwhelmed", "overwhelm", "pressure", "too much", "burnt out", "burned out"],
  unmotivated: ["unmotivated", "demotivated", "no motivation", "not motivated", "no drive", "dont feel like", "don't feel like"],
  stuck: ["stuck", "lost", "going nowhere", "no progress", "directionless"],
  tired: ["tired", "exhausted", "drained", "sleepy", "no energy", "worn out"],
  lonely: ["lonely", "alone", "isolated", "no one", "nobody"],
  angry: ["angry", "furious", "frustrated", "irritated", "mad at", "rage"],
}

// Which feeling, if any, a sentence expresses. Returns the vocabulary word.
// Whole-word match for short words so "mad" does not fire inside "made".
export const feelingIn = (text: string): string | null => {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9ऀ-ॿ' ]/g, " ").replace(/\s+/g, " ")} `
  for (const [feeling, words] of Object.entries(FEELING_WORDS)) {
    if (words.some((w) => (w.length <= 4 ? t.includes(` ${w} `) : t.includes(w)))) return feeling
  }
  return null
}

// "lazy" and the model's wording ("laziness", "feeling lazy") reach the same key.
export const normalizeFeeling = (word: string): string | null => {
  const w = word.toLowerCase().trim()
  if (w in FEELING_WORDS) return w
  return feelingIn(w)
}

export interface ShelfItem {
  id: string
  title: string
  url: string | null
  triggerTags: string[]
  usedCount: number
  helpfulCount: number
}

// ---- the person's own moods (ADR 0029) ---------------------------------------------
// A mood is any short label they choose for a save: "before an exam", "bored",
// "need to focus". No table: their moods are the shelf tags outside the fixed list.

const LEAD = /^(?:when\s+)?(?:i\s*'?m|i\s+am|im|i\s+feel|feeling|for\s+when\s+i\s*'?m|for\s+when\s+i|for|when\s+i|when)\s+/i

// "When I'm bored." → "bored". Null if nothing usable is left.
export const cleanMood = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null
  let t = raw.toLowerCase().replace(/[^a-z0-9ऀ-ॿ' -]/g, " ").replace(/\s+/g, " ").trim()
  for (let i = 0; i < 2; i++) t = t.replace(LEAD, "").trim()
  t = t.replace(/^[-' ]+|[-' ]+$/g, "")
  return t.length >= 2 && t.length <= 24 ? t : null
}

// What gets stored for a save: the vocabulary word when the label means one, else the label itself.
export const moodKey = (raw: unknown): string | null => {
  const clean = cleanMood(raw)
  if (!clean) return null
  return normalizeFeeling(clean) ?? clean
}

// Up to 3 distinct moods from whatever the phone sent.
export const cleanMoods = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map(moodKey).filter((m): m is string => !!m))].slice(0, 3)
}

// The person's own moods, most used first: shelf tags the fixed list does not cover.
export const ownMoods = (items: Pick<ShelfItem, "triggerTags">[]): { mood: string; count: number }[] => {
  const counts = new Map<string, number>()
  for (const i of items) {
    for (const t of i.triggerTags) {
      const m = cleanMood(t)
      if (m && !normalizeFeeling(m)) counts.set(m, (counts.get(m) ?? 0) + 1)
    }
  }
  return [...counts].map(([mood, count]) => ({ mood, count })).sort((a, b) => b.count - a.count || a.mood.localeCompare(b.mood))
}

// Which of their own moods a sentence says ("I'm bored", "show me something for before an exam").
// Needs a first-person or request lead, or a very short message, so a mood word inside
// ordinary talk ("the bored cat") does not fire. Longest mood wins.
const SAYS_MOOD = /\b(?:i\s*'?m|i\s+am|im|i\s+feel|feeling|show|need|want|something\s+for|for\s+when|when)\b/
export const customMoodIn = (text: string, moods: string[]): string | null => {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9ऀ-ॿ' ]/g, " ").replace(/\s+/g, " ").trim()} `
  const short = t.trim().split(" ").length <= 4
  if (!short && !SAYS_MOOD.test(t)) return null
  const hit = [...moods].sort((a, b) => b.length - a.length).find((m) => t.includes(` ${m} `))
  return hit ?? null
}

export const matchComfort = <T extends ShelfItem>(feeling: string, items: T[]): T[] => {
  const vocab = normalizeFeeling(feeling)
  // Their own mood: exact label, no synonyms.
  const key = vocab ?? cleanMood(feeling)
  if (!key) return []
  const group = new Set(vocab ? [vocab, ...FEELING_WORDS[vocab]!] : [key])
  return items
    .filter((i) => i.triggerTags.some((t) => group.has(t.toLowerCase()) || (vocab ? normalizeFeeling(t) === vocab : cleanMood(t) === key)))
    // What helped before comes first; among equals, the one shown least.
    .sort((a, b) => b.helpfulCount - a.helpfulCount || a.usedCount - b.usedCount || a.title.localeCompare(b.title))
}

export const NO_STEP = "Just a glass of water and two quiet minutes. That counts."

export const comfortBlock = (item: Pick<ShelfItem, "title" | "url">, step: string | null): string =>
  `You saved this for days like this: "${item.title}"${item.url ? ` (${item.url})` : ""}. Smallest next step: ${step ?? NO_STEP}`
