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

export const matchComfort = <T extends ShelfItem>(feeling: string, items: T[]): T[] => {
  const key = normalizeFeeling(feeling)
  if (!key) return []
  const group = new Set([key, ...FEELING_WORDS[key]!])
  return items
    .filter((i) => i.triggerTags.some((t) => group.has(t.toLowerCase()) || normalizeFeeling(t) === key))
    // What helped before comes first; among equals, the one shown least.
    .sort((a, b) => b.helpfulCount - a.helpfulCount || a.usedCount - b.usedCount || a.title.localeCompare(b.title))
}

export const NO_STEP = "Just a glass of water and two quiet minutes. That counts."

export const comfortBlock = (item: Pick<ShelfItem, "title" | "url">, step: string | null): string =>
  `You saved this for days like this: "${item.title}"${item.url ? ` (${item.url})` : ""}. Smallest next step: ${step ?? NO_STEP}`
