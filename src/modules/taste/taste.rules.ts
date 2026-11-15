// Three small tastes for an area someone is unsure about, then a decision:
// keep going, try another direction, or drop it for now. Clarity comes from
// trying, not from more planning. Pure rules; the AI only suggests wording.

export interface Taste {
  title: string
  minutes: number
}

export const TASTE_COUNT = 3
export const TASTES_KIND = "TASTES"
export const DECISIONS = ["KEEP", "CHANGE", "DROP"] as const
export type Decision = (typeof DECISIONS)[number]

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "")

// "Taste 2: hum and record a melody". The number is added by code, so the
// person (and the model) only write what to do.
export const tasteTitle = (n: number, title: string): string => `Taste ${n}: ${title.replace(/^taste\s*\d+\s*[:.-]\s*/i, "")}`.slice(0, 200)

// When nothing better is known: three ways into any area, from easiest to most real.
export const fallbackTastes = (area: string): Taste[] => {
  const a = area.trim() || "this"
  return [
    { title: `Try the simplest version of ${a} for half an hour`, minutes: 30 },
    { title: `Watch or read one beginner guide to ${a}`, minutes: 30 },
    { title: `Make or do one small thing in ${a}`, minutes: 45 },
  ]
}

// Exactly three, each 15 to 90 minutes, filled in from the fallback when
// something is missing or broken. Accepts the model's answer or the person's edits.
export const cleanTastes = (raw: unknown, area: string): Taste[] => {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { tastes?: unknown })?.tastes) ? (raw as { tastes: unknown[] }).tastes : []
  const fallback = fallbackTastes(area)
  const out: Taste[] = []
  for (const x of list) {
    const r = (x ?? {}) as Record<string, unknown>
    const title = str(r.title, 150).replace(/^taste\s*\d+\s*[:.-]\s*/i, "")
    if (!title) continue
    const m = Math.round(Number(r.minutes))
    out.push({ title, minutes: m >= 15 && m <= 90 ? m : 30 })
    if (out.length === TASTE_COUNT) break
  }
  while (out.length < TASTE_COUNT) out.push(fallback[out.length]!)
  return out
}

export interface TasteRound {
  goalId: string
  done: number
  total: number
  // All tastes done: time to decide.
  decide: boolean
}

// Where a round stands, from its taste to-dos.
export const roundOf = (goalId: string, tasks: { status: string; archivedAt: Date | null }[]): TasteRound => {
  const live = tasks.filter((t) => t.archivedAt === null || t.status === "COMPLETED")
  const done = live.filter((t) => t.status === "COMPLETED").length
  const total = Math.max(live.length, done)
  return { goalId, done, total, decide: total > 0 && done >= total }
}

export const decisionWords = (d: Decision, area: string): string =>
  d === "KEEP"
    ? `${area} stays. Next, make it concrete.`
    : d === "CHANGE"
      ? `New tastes for ${area}, in another direction.`
      : `${area} is resting. Dropping it on purpose is a decision, not a failure.`
