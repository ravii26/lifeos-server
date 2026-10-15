/* =====================================================================
   Goal → weekly targets (plan 16 §1, Layer 1). The AI proposes; these
   pure rules decide what is allowed: they clean the proposal, make it fit
   the free time the person really has ("a better way" by code), and say
   "not now" when a Main goal with a near deadline is already behind.
   Nothing is saved until the person keeps it.
   ===================================================================== */
import { BLOCKS, type Block } from "../now/now.rules.js"

export interface PlanTarget {
  title: string
  unit: "min" | "count"
  perWeek: number // minutes or things per week
  countUnit: string | null // "applications"
  sessionMinutes: number | null
  block: Block | null
  note: string | null // "≈ 50 min most mornings"
}

export interface GoalPlan {
  title: string
  why: string | null
  deadline: string | null // YYYY-MM-DD
  targets: PlanTarget[]
  milestones: string[]
  question: string | null // one thing the AI needs to know (e.g. the deadline)
}

export interface PlanCaution {
  kind: "MAIN_GOAL_TIGHT"
  message: string
  parkUntil: string | null // the busy goal's deadline
}

export interface PlanFit {
  weeklyFreeMinutes: number
  alreadyCommitted: number // other weekly targets
  plannedMinutes: number // this plan, after any scaling
  scaled: boolean
  message: string | null
}

const MAX_TARGETS = 6
const DATE = /^\d{4}-\d{2}-\d{2}$/

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v))

// Accepts the model's JSON (or an edited plan from the app) and keeps only
// what makes sense. Unknown or broken fields are dropped, never guessed.
export const cleanPlan = (raw: unknown, todayKey: string): GoalPlan | null => {
  const r = (raw ?? {}) as Record<string, unknown>
  const title = str(r.title, 120)
  if (!title) return null
  const deadline = typeof r.deadline === "string" && DATE.test(r.deadline) && r.deadline > todayKey ? r.deadline : null
  const targets: PlanTarget[] = []
  for (const t of Array.isArray(r.targets) ? r.targets : []) {
    const x = (t ?? {}) as Record<string, unknown>
    const tTitle = str(x.title, 80)
    const unit = x.unit === "count" ? "count" : x.unit === "min" ? "min" : null
    const perWeek = Math.round(num(x.perWeek))
    if (!tTitle || !unit || !(perWeek > 0)) continue
    if (unit === "min" && perWeek > 3000) continue // > 50 h a week is not a plan
    if (unit === "count" && perWeek > 500) continue
    const session = Math.round(num(x.sessionMinutes))
    const block = typeof x.block === "string" && (BLOCKS as readonly string[]).includes(x.block) ? (x.block as Block) : null
    targets.push({
      title: tTitle,
      unit,
      perWeek,
      countUnit: unit === "count" ? str(x.countUnit, 40) || "times" : null,
      sessionMinutes: session > 0 && session <= 240 ? session : null,
      block: block === "OFFICE" ? null : block, // personal goals live outside office hours
      note: str(x.note, 120) || null,
    })
    if (targets.length >= MAX_TARGETS) break
  }
  const milestones = (Array.isArray(r.milestones) ? r.milestones : []).map((m) => str(m, 120)).filter(Boolean).slice(0, 8)
  const question = str(r.question, 200) || null
  if (!targets.length && !question) return null
  return { title, why: str(r.why, 300) || null, deadline, targets, milestones, question }
}

// Minutes a counted target takes in a week: its sessions, or 15 min a thing.
const weeklyMinutesOf = (t: PlanTarget): number =>
  t.unit === "min" ? t.perWeek : Math.round(t.perWeek * Math.max(5, Math.min(60, t.sessionMinutes ?? 15)))

// The plan must fit the free time left after the person's other weekly
// targets. If it doesn't, every target is scaled down by the same share,
// and the person is told plainly (a better way, decided by code).
export const fitPlan = (plan: GoalPlan, weeklyFreeMinutes: number, alreadyCommitted: number): { plan: GoalPlan; fit: PlanFit } => {
  const planned = plan.targets.reduce((s, t) => s + weeklyMinutesOf(t), 0)
  const room = Math.max(0, Math.round(weeklyFreeMinutes * 0.8) - alreadyCommitted) // leave a fifth for rest and life
  if (!planned || planned <= room) {
    return { plan, fit: { weeklyFreeMinutes, alreadyCommitted, plannedMinutes: planned, scaled: false, message: null } }
  }
  const share = room / planned
  const scaled = plan.targets.map((t) => ({ ...t, perWeek: Math.max(1, Math.round(t.perWeek * share)) }))
  const after = scaled.reduce((s, t) => s + weeklyMinutesOf(t), 0)
  const hrs = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")} h`
  return {
    plan: { ...plan, targets: scaled },
    fit: {
      weeklyFreeMinutes,
      alreadyCommitted,
      plannedMinutes: after,
      scaled: true,
      message: `That needs about ${hrs(planned)} a week, but you have about ${hrs(room)} free after your other goals. I scaled each part down to fit; a plan you keep beats a bigger one you drop.`,
    },
  }
}

export interface BusyGoal {
  title: string
  tier: "MAIN" | "SECONDARY" | "MAINTAIN" | "LATER"
  deadlineKey: string | null
  behind: boolean // a weekly target under its pace
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

// "Not now": a Main goal is due within 6 weeks and already behind. The new
// goal can wait until that deadline; the person decides.
export const cautionFor = (busy: BusyGoal[], todayKey: string): PlanCaution | null => {
  const tight = busy
    .filter((g) => g.tier === "MAIN" && g.behind && g.deadlineKey && daysBetween(todayKey, g.deadlineKey) >= 0 && daysBetween(todayKey, g.deadlineKey) <= 42)
    .sort((a, b) => a.deadlineKey!.localeCompare(b.deadlineKey!))[0]
  if (!tight) return null
  const weeks = Math.max(1, Math.round(daysBetween(todayKey, tight.deadlineKey!) / 7))
  return {
    kind: "MAIN_GOAL_TIGHT",
    message: `Not now, maybe: ${tight.title} is in ${weeks} week${weeks === 1 ? "" : "s"} and already behind. I can park this until ${tight.deadlineKey} and bring it up then. Or start it anyway.`,
    parkUntil: tight.deadlineKey,
  }
}
