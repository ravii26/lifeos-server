// Library extras (ALLY.md 5.2 #17): rules that show up before an event, and a
// message Ally drafts for a person. Code decides when rules show and checks
// every draft; the AI only writes the words, and without it a plain draft is used.

const STOP = new Set([
  "rules", "rule", "lines", "line", "notes", "note", "list", "before", "after", "when", "with", "your", "what", "this", "that",
  "ready", "things", "stuff", "about", "from", "into", "have", "will", "some", "more", "less", "good", "my", "and", "the", "for",
])

/** The words that say what a set of rules is for: "Party and outside-food rules" → party, outside, food. */
export const triggerWords = (title: string, collection = ""): string[] =>
  [...new Set(`${title} ${collection}`.toLowerCase().split(/[^a-zऀ-ॿ]+/).filter((w) => w.length >= 4 && !STOP.has(w)))]

export interface RuleNote {
  id: string
  title: string
  collection: string
  items: string[]
  showBefore: boolean
}

export interface DayItem {
  title: string
}

/** Rules switched on to show before an event, whose words appear in something on today or tomorrow. */
export const rulesForToday = (notes: RuleNote[], items: DayItem[]): { id: string; title: string; items: string[]; because: string }[] => {
  const out: { id: string; title: string; items: string[]; because: string }[] = []
  for (const n of notes) {
    if (!n.showBefore || !n.items.length) continue
    const words = triggerWords(n.title, n.collection)
    const hit = items.find((i) => words.some((w) => new RegExp(`\\b${w}`, "i").test(i.title)))
    if (hit) out.push({ id: n.id, title: n.title, items: n.items, because: hit.title })
    if (out.length >= 2) break
  }
  return out
}

const LINK = /(https?:\/\/|www\.)/i

/** A draft is kept only if it is short, plain and has no links; otherwise the plain one is used. */
export const cleanDraft = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null
  const t = raw.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, " ")
  if (t.length < 5 || t.length > 300 || LINK.test(t)) return null
  return t
}

/** Without AI: a warm, plain opener. */
export const fallbackDraft = (name: string, daysSince: number | null): string => {
  const first = name.trim().split(/\s+/)[0] || "there"
  return daysSince !== null && daysSince >= 14
    ? `Hi ${first}, it's been a while. How have you been?`
    : `Hi ${first}, how are you doing?`
}

export const draftPrompt = (name: string, told: string[], daysSince: number | null) => `Write one short, warm message (one or two sentences, under 200 characters) that someone can send to ${name}.
${told.length ? `Things ${name} told them: ${told.slice(0, 5).join("; ")}.` : ""}
${daysSince === null ? "" : `They last spoke ${daysSince} days ago.`}
If something they told is a worry or an event, ask kindly about it. Plain, friendly, no emoji, no links, no promises. Return the message only.`
