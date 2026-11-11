/* =====================================================================
   Keeping memory true. Memory systems rarely fail by inventing facts; they
   fail by never retiring old ones. So a memory now has an end: `endedAt` in
   the past means it stopped being true (kept as history), in the future
   means it is true until then ("in Goa till Sunday"). Everything here is
   pure; the database and AI side is in assistant.memory.truth.ts.
   ===================================================================== */
import { localDayStartMs, todayKeyInTz } from "../../shared/utils/time.util.js"

export const isCurrent = (m: { endedAt: Date | null }, now: Date = new Date()): boolean => !m.endedAt || m.endedAt.getTime() > now.getTime()

// The same test as a database filter.
export const currentMemoryWhere = (now: Date = new Date()) => ({ OR: [{ endedAt: null }, { endedAt: { gt: now } }] })

const plain = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()

const MIN_QUOTE_CHARS = 8
const LONG_WITH_LINK_CHARS = 600
const PASTED_CHARS = 3000

// Text pasted from somewhere else is not the person speaking, and a planted
// sentence in an article must not become a memory.
export const ownWords = (messages: string[]): string[] =>
  messages.filter((m) => m.length <= PASTED_CHARS && !(m.length > LONG_WITH_LINK_CHARS && /https?:\/\//i.test(m)))

// A memory is kept only if the words it came from are really in what the
// person wrote. Needs no AI. A very short quote must be their whole message
// ("yes", "Morning"), otherwise any common word would pass.
export const quoteIsTheirs = (quote: unknown, said: string[]): boolean => {
  if (typeof quote !== "string") return false
  const q = plain(quote)
  if (!q) return false
  return said.some((message) => {
    const m = plain(message)
    return m === q || (q.length >= MIN_QUOTE_CHARS && ` ${m} `.includes(` ${q} `))
  })
}

// Feelings and events happened on a date, so they stay true forever.
const MOMENTS = new Set(["FEELING", "EVENT"])

export interface TruthFact {
  kind: string
  source: string
}

// A guess never overrules something the person said.
export const canEnd = (old: TruthFact, fresh: TruthFact): boolean =>
  !MOMENTS.has(old.kind) && !MOMENTS.has(fresh.kind) && !(fresh.source === "INFERRED" && old.source === "SAID")

const MAX_UNTIL_DAYS = 730

// The end of the local day named by the model's "until", or null if it is not
// a real date from today up to two years ahead.
export const endFromUntil = (until: unknown, timeZone: string, now: Date = new Date()): Date | null => {
  if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return null
  const day = Date.parse(`${until}T00:00:00.000Z`)
  if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== until) return null
  const today = Date.parse(`${todayKeyInTz(timeZone, now)}T00:00:00.000Z`)
  if (day < today || day > today + MAX_UNTIL_DAYS * 86_400_000) return null
  return new Date(localDayStartMs(new Date(day + 86_400_000).toISOString().slice(0, 10), timeZone))
}

export const idsFrom = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === "string" && id.length > 0)

const STOP = new Set("a an the and or but has have had his her their they them with from for of in on at to is am are was were".split(" "))
const words = (s: string) => new Set(plain(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)))

// Related memories sit around 0.64-0.73 and unrelated ones 0.54-0.60 (ADR
// 0035). The floor is on the low side on purpose: "Works at TCS" and "Joined
// Infosys" share no words, and the AI makes the final call on this short list.
const RELATED_FLOOR = 0.6
const MAX_CANDIDATES = 5

export interface CandidateFact extends TruthFact {
  id: string
  content: string
}

// Which old memories are close enough to the new one to be worth asking about.
export const oldFactCandidates = <T extends CandidateFact>(fresh: TruthFact & { content: string }, others: T[], similar?: Map<string, number>): T[] => {
  const mine = words(fresh.content)
  return others
    .filter((o) => canEnd(o, fresh))
    .map((o) => ({ o, close: similar?.get(o.id) ?? 0, shared: [...words(o.content)].filter((w) => mine.has(w)).length }))
    .filter((x) => x.close >= RELATED_FLOOR || x.shared > 0)
    .sort((a, b) => b.close - a.close || b.shared - a.shared)
    .slice(0, MAX_CANDIDATES)
    .map((x) => x.o)
}

// The AI's answer, keeping only ids it was actually shown.
export const parseEnded = (raw: string | null | undefined, shown: { id: string }[]): string[] => {
  if (!raw) throw new Error("empty answer")
  const ids = idsFrom((JSON.parse(raw) as { noLongerTrue?: unknown }).noLongerTrue ?? [])
  const allowed = new Set(shown.map((s) => s.id))
  return [...new Set(ids.filter((id) => allowed.has(id)))]
}

// Past facts are only brought in when the question is about the past.
const ASKS_ABOUT_PAST = /\bused to\b|\bpreviously\b|\bno longer\b|\bmy (?:old|previous|last|former|ex)\b|\bpehle\b|\b(?:did|was|were) .*\bbefore\b/i
export const asksAboutThePast = (message: string): boolean => ASKS_ABOUT_PAST.test(message)
