import { findDecisionContext } from "./decisions.repository.js"
import { getDecisions } from "./decisions.ai.js"
import type { DecisionResult } from "./decisions.ai.js"
import { listBlocksService } from "../calendar/calendar.service.js"
import { dayKeyInTz, localDayStartMs } from "../../shared/utils/time.util.js"
import logger from "../../lib/logger.js"

const DAY_MS = 24 * 60 * 60 * 1000

// A brand-new account has no areas/goals/tasks/habits/identity for the coach
// to reason over — the urgency-hierarchy prompt still runs and produces a
// confident-sounding but nonsensical answer (e.g. "conduct a weekly review"
// for a week that has zero activity, because "everything's empty" isn't a
// case the prompt was written to recognize). Detect true cold start and skip
// the AI/heuristic entirely: there's nothing real for either to reason about
// yet, so a hand-written welcome is more honest than a hallucinated one.
type DecisionContext = Awaited<ReturnType<typeof findDecisionContext>>

const isColdStart = (ctx: DecisionContext): boolean =>
  ctx.areas.length === 0 &&
  ctx.pendingTasks.length === 0 &&
  ctx.overdueTasks.length === 0 &&
  ctx.activeGoals.length === 0 &&
  ctx.habits.length === 0 &&
  !ctx.identity?.purpose

const coldStartResult = (): DecisionResult => ({
  headline: "Let's set up your first Area",
  briefing:
    "Everything in LifeOS hangs off an Area — Career, Health, Relationships, whatever matters to you. Once you've got one, I can start turning your goals, habits, and tasks into an actual plan instead of guessing.",
  tone: "encouraging",
  primaryAction: {
    type: "AREA_FOCUS",
    refId: null,
    title: "Create your first Area",
    why: "It's the one thing everything else — goals, habits, tasks, the coaching itself — needs before it can do anything useful.",
    estimatedMinutes: 2,
  },
  suggestions: [
    {
      rank: 1,
      type: "AREA_FOCUS",
      refId: null,
      title: "Create your first Area",
      reason: "Areas are the spine of the whole system — goals, habits, and tasks all attach to one.",
      urgency: "HIGH",
      actionableSteps: ["Open Areas", "Add one (e.g. \"Health\" or \"Career\")", "Come back here"],
    },
    {
      rank: 2,
      type: "CAPTURE",
      refId: null,
      title: "Or just capture what's on your mind",
      reason: "If you're not sure where to start, brain-dump anything and I'll help sort it out.",
      urgency: "MEDIUM",
      actionableSteps: ["Open Capture", "Write whatever's on your mind", "I'll classify it for you"],
    },
  ],
  neglectedArea: null,
  todayFocus: "Set up your first Area",
  behaviorInsight: "No data yet — that's expected for a new account, not a sign anything's wrong.",
  weeklyPattern: "Nothing logged yet.",
  streakAlerts: [],
  schedule: { current: null, next: null, todayCount: 0 },
  generatedAt: new Date(),
  source: "heuristic",
})

export const getDecisionsService = async (userId: string): Promise<DecisionResult> => {
  const context = await findDecisionContext(userId)

  if (isColdStart(context)) {
    return coldStartResult()
  }

  // Today's schedule (expanded for recurrence/exceptions), in the user's
  // timezone, so the engine can reason about what they're time-blocked into
  // right now. Non-fatal: if the calendar read fails, the engine still runs.
  const tz = context.timezone
  const dayStartMs = localDayStartMs(dayKeyInTz(new Date(), tz), tz)
  const todayBlocks = await listBlocksService(userId, {
    from: new Date(dayStartMs),
    to: new Date(dayStartMs + DAY_MS),
  }).catch((err) => {
    logger.warn(`Decisions: calendar fetch failed, continuing without schedule: ${err}`)
    return []
  })

  return getDecisions(context, todayBlocks)
}
