/* =====================================================================
   Milestones (5.0 #44): a long goal split into 3 to 6 small goals, each
   reachable in 1 to 4 weeks. A milestone is a Goal row under the big goal
   (`parentId`, `order`); its steps are tasks with `goalId` = the milestone.

   State lives in the existing `status` column, so suggestions can tell
   which steps to offer with no extra query:
     COMPLETED = reached, ACTIVE = the current one, PAUSED = still to come,
     ABANDONED = let go.
   Progress only moves forward: a reached milestone stays reached (adding
   a step to it does not reopen it), and done steps keep counting even if
   they are later let go. Only the person's own Undo takes it back.
   Pure rules: no database, no clock, no AI.
   ===================================================================== */

export const MILESTONE_KIND = "MILESTONE"
export const MIN_MILESTONES = 3
export const MAX_MILESTONES = 6

export type MilestoneState = "REACHED" | "CURRENT" | "NEXT"

export interface MilestoneRow {
  id: string
  title: string
  order: number
  status: string // GoalStatus
  stepsDone: number // completed steps, archived or not
  stepsOpen: number // steps still to do (not let go)
}

export interface MilestoneView {
  id: string
  title: string
  order: number
  state: MilestoneState
  stepsDone: number
  stepsTotal: number
}

export interface GoalProgress {
  milestones: MilestoneView[]
  total: number
  reached: number
  current: MilestoneView | null
  /** 1-based place of the current milestone; total + 1 when all are reached. */
  index: number
  /** Every step of the current milestone is done: ask whether it is reached. */
  ready: boolean
  /** "Milestone 2 of 5: run 5 km without stopping · 3 of 6 steps done" */
  line: string
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "")

// The AI's (or the person's edited) list: titles only, in order, no blanks
// or repeats, at most six. Objects with a title are accepted too.
export const cleanMilestones = (raw: unknown): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of Array.isArray(raw) ? raw : []) {
    const title = str(typeof m === "object" && m !== null ? (m as Record<string, unknown>).title : m, 120).replace(/[.]+$/, "")
    const key = title.toLowerCase()
    if (!title || seen.has(key)) continue
    seen.add(key)
    out.push(title)
    if (out.length >= MAX_MILESTONES) break
  }
  return out
}

// Without AI: three plain milestones from the goal and what done looks like.
// They are a draft the person edits before saving, never a claim.
export const fallbackMilestones = (goal: string, done?: string | null): string[] => {
  const g = goal.trim().replace(/[.!]+$/, "")
  const end = done?.trim().replace(/[.!]+$/, "") || g
  return cleanMilestones([`First steps done`, `Halfway to: ${lower(end)}`, cap(end)])
}

const lower = (s: string) => (s && s[0] === s[0].toUpperCase() && s[1] !== s[1]?.toUpperCase() ? s[0].toLowerCase() + s.slice(1) : s)
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

const stateOf = (status: string): MilestoneState | null =>
  status === "COMPLETED" ? "REACHED" : status === "ACTIVE" ? "CURRENT" : status === "ABANDONED" ? null : "NEXT"

// Where a goal with milestones stands. The current one is the first not
// reached; if the stored status says otherwise (an older row, an Undo that
// left two open) the order decides, so the line is always one place.
export const goalProgress = (rows: MilestoneRow[]): GoalProgress | null => {
  const kept = rows.filter((r) => stateOf(r.status) !== null).sort((a, b) => a.order - b.order)
  if (!kept.length) return null
  const firstOpen = kept.findIndex((r) => r.status !== "COMPLETED")
  const milestones: MilestoneView[] = kept.map((r, i) => ({
    id: r.id,
    title: r.title,
    order: r.order,
    state: r.status === "COMPLETED" ? "REACHED" : i === firstOpen ? "CURRENT" : "NEXT",
    stepsDone: r.stepsDone,
    stepsTotal: r.stepsDone + r.stepsOpen,
  }))
  const total = milestones.length
  const reached = milestones.filter((m) => m.state === "REACHED").length
  const current = firstOpen >= 0 ? milestones[firstOpen] : null
  if (!current) return { milestones, total, reached, current: null, index: total + 1, ready: false, line: `All ${total} milestones reached` }
  const steps = current.stepsTotal ? ` · ${current.stepsDone} of ${current.stepsTotal} steps done` : ""
  return {
    milestones,
    total,
    reached,
    current,
    index: firstOpen + 1,
    ready: current.stepsDone > 0 && current.stepsDone === current.stepsTotal,
    line: `Milestone ${firstOpen + 1} of ${total}: ${current.title}${steps}`,
  }
}

export interface ReachPlan {
  reach: string
  open: string | null // the next milestone to open, if any
}

// Marking a milestone reached: only the current one (the first not reached).
// The next one opens. Returns null when that milestone can't be reached now.
export const reachPlan = (rows: MilestoneRow[], id: string): ReachPlan | null => {
  const p = goalProgress(rows)
  if (!p?.current || p.current.id !== id) return null
  const next = p.milestones.find((m) => m.order > p.current!.order && m.state === "NEXT")
  return { reach: id, open: next?.id ?? null }
}

// Letting a milestone go: it is kept (ABANDONED), its open steps are let go
// with it, and if it was the current one the next opens.
export const letGoPlan = (rows: MilestoneRow[], id: string): ReachPlan | null => {
  const p = goalProgress(rows)
  const m = p?.milestones.find((x) => x.id === id)
  if (!p || !m || m.state === "REACHED") return null
  if (m.state !== "CURRENT") return { reach: id, open: null }
  const next = p.milestones.find((x) => x.order > m.order && x.state === "NEXT")
  return { reach: id, open: next?.id ?? null }
}

// A step under a milestone is offered only while that milestone is the
// current one; steps of later milestones wait, steps of reached ones rest.
export const stepOffered = (goal: { parentId: string | null; status: string } | null | undefined): boolean =>
  !goal?.parentId || goal.status === "ACTIVE"
