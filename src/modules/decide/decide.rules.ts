// "Help me decide": two options → a suggestion with a reason, a first step,
// and a day to check in. The AI may suggest and explain; these rules decide
// what is allowed, and give a plain method when no AI answers.

export const HARD = ["MONEY", "TIME", "FEAR", "PEOPLE", "UNSURE"] as const
export type Hard = (typeof HARD)[number]

export interface Decision {
  pick: "A" | "B" | "EITHER"
  why: string
  firstStep: string
  checkInDays: number
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "")

// Health, law and large money: Ally does not choose; it says who to ask.
const SERIOUS = /\b(doctor|surgery|medicine|medication|diagnos|pregnan|lawyer|legal|court|divorce|loan|mortgage|invest|stock|crypto|insurance)\b/i

export const isSerious = (a: string, b: string): boolean => SERIOUS.test(`${a} ${b}`)

export const checkInDays = (v: unknown): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(30, Math.max(3, n)) : 7
}

// Without AI: no pretend judgment, just a way to stop circling.
export const fallbackDecision = (hard: Hard[]): Decision => ({
  pick: "EITHER",
  why: hard.includes("FEAR")
    ? "When both are reasonable, the fear is usually of picking wrong, not of either option. The one that is easier to undo is the better first try."
    : "When neither clearly wins, the one that is easier to undo is the better first try. A week of doing it will tell you more than more thinking.",
  firstStep: "Pick one now and do the first 15 minutes of it.",
  checkInDays: 7,
})

export const SERIOUS_DECISION: Decision = {
  pick: "EITHER",
  why: "This one touches health, law or a large amount of money, so it deserves someone qualified who knows your situation.",
  firstStep: "Write down your two options and your main question, then book time with someone qualified.",
  checkInDays: 7,
}

// Keeps only a usable answer from the model (null = no AI answered). On
// serious matters Ally never picks, whatever the model said or whether it answered.
export const cleanDecision = (raw: unknown, a: string, b: string, hard: Hard[]): Decision => {
  if (isSerious(a, b)) return SERIOUS_DECISION
  if (raw === null || raw === undefined) return fallbackDecision(hard)
  const r = raw as Record<string, unknown>
  const pick = r.pick === "A" || r.pick === "B" || r.pick === "EITHER" ? r.pick : null
  const why = str(r.why, 320)
  const firstStep = str(r.firstStep, 160)
  if (!pick || !why || !firstStep) return fallbackDecision(hard)
  return { pick, why, firstStep, checkInDays: checkInDays(r.checkInDays) }
}

// "Check in: how is moving to Pune going?"
export const checkInTitle = (choice: string): string => `Check in: how is "${str(choice, 120)}" going?`
