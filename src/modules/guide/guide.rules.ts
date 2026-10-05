// Pure rules for the guide's nightly pick. No DB, no AI: the rules decide what
// is SAFE to suggest (a ranked shortlist + drift state); the AI only chooses
// among the shortlist and writes the words. If the AI is down, option 1 wins.

export type Tier = "MAIN" | "SECONDARY" | "MAINTAIN" | "LATER"
export type CommitmentState = "PENDING" | "DONE" | "MINIMUM" | "SKIPPED"

export interface CandidateInput {
  sourceType: "TASK" | "HABIT"
  sourceId: string
  title: string
  minimumVersion: string | null
  areaId: string | null
  areaName: string | null
  tier: Tier
  goalId: string | null
  goalTitle: string | null
  goalWhy: string | null
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  dueKey?: string | null // YYYY-MM-DD in the user's timezone
}

export interface Candidate extends CandidateInput {
  score: number
  minimum: string
  why: string
}

export interface RecentCommitment {
  dateKey: string
  sourceId: string
  status: CommitmentState
}

const TIER_WEIGHT: Record<Tier, number> = { MAIN: 100, SECONDARY: 60, MAINTAIN: 25, LATER: 0 }
const PRIORITY_WEIGHT = { LOW: 0, MEDIUM: 8, HIGH: 18, CRITICAL: 28 } as const

export const DEFAULT_MINIMUM = "Just start. 2 minutes on it counts."

// A LATER area comes back on its own once its date passes — "later, with a
// date" is what makes parking things feel safe.
export const effectiveTier = (tier: Tier, laterUntil: Date | null, now: Date): Tier =>
  tier === "LATER" && laterUntil && laterUntil.getTime() <= now.getTime() ? "MAINTAIN" : tier

export const whyFor = (c: CandidateInput): string => {
  if (c.goalWhy) return c.goalWhy
  if (c.goalTitle) return `It moves you toward "${c.goalTitle}".`
  if (c.tier === "MAIN" && c.areaName) return `${c.areaName} is your main focus right now.`
  if (c.areaName) return `It keeps ${c.areaName} moving.`
  return "Small steps keep the week alive."
}

// Recent skips of the same item push it down (but never out): something you
// keep dodging needs a smaller version, not a fourth identical nudge.
export const scoreCandidate = (
  c: CandidateInput,
  todayKey: string,
  recent: RecentCommitment[],
): number => {
  let score = TIER_WEIGHT[c.tier]
  if (c.goalId) score += 15
  if (c.priority) score += PRIORITY_WEIGHT[c.priority]
  if (c.dueKey) {
    if (c.dueKey < todayKey) score += 25
    else if (c.dueKey === todayKey) score += 15
  }
  if (c.sourceType === "HABIT") score += 5
  const skips = recent.filter((r) => r.sourceId === c.sourceId && r.status === "SKIPPED").length
  score -= skips * 12
  return score
}

export const shortlist = (
  inputs: CandidateInput[],
  todayKey: string,
  recent: RecentCommitment[],
  size = 3,
): Candidate[] =>
  inputs
    .filter((c) => c.tier !== "LATER")
    .map((c) => ({
      ...c,
      score: scoreCandidate(c, todayKey, recent),
      minimum: c.minimumVersion?.trim() || DEFAULT_MINIMUM,
      why: whyFor(c),
    }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, size)

// Consecutive missed nights before today. An unanswered night counts as
// missed; a night with no commitment at all (app not used) breaks the chain
// rather than counting, so a holiday doesn't read as failure.
export const missedStreak = (recent: RecentCommitment[], todayKey: string): number => {
  const byDay = new Map(recent.map((r) => [r.dateKey, r.status]))
  let streak = 0
  let cursor = new Date(`${todayKey}T00:00:00.000Z`)
  for (let i = 0; i < 14; i++) {
    cursor = new Date(cursor.getTime() - 86_400_000)
    const status = byDay.get(cursor.toISOString().slice(0, 10))
    if (status === "SKIPPED" || status === "PENDING") streak++
    else break
  }
  return streak
}

export const SMALLER_AFTER_MISSES = 2

export const heuristicMessage = (pick: Candidate, mode: "NORMAL" | "SMALLER", misses: number): string =>
  mode === "SMALLER"
    ? `You missed ${misses} nights. That happens, no restart needed. Tonight just this: ${pick.minimum}`
    : `Tonight: ${pick.title}. If you're tired, the minimum still counts: ${pick.minimum}`
