import { findDecisionContext } from "./decisions.repository.js"
import { getDecisions } from "./decisions.ai.js"
import type { DecisionResult } from "./decisions.ai.js"
import { listBlocksService } from "../calendar/calendar.service.js"
import { dayKeyInTz, localDayStartMs } from "../../shared/utils/time.util.js"
import { findSettings, upsertSettings } from "../settings/settings.repository.js"
import { upsertIdentityService } from "../identity/identity.service.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import logger from "../../lib/logger.js"

const DAY_MS = 24 * 60 * 60 * 1000
const PROFILE_PROMPT_COOLDOWN_MS = DAY_MS

// At most one profiling question per day — this is what keeps the "ask one
// thing" loop from becoming a nag. Suppresses the prompt (doesn't touch the
// rest of the result) if one was already shown within the cooldown, and
// stamps lastProfilePromptAt the moment a fresh one goes out, not when (or
// whether) it's answered.
const applyProfilePromptCooldown = async (
  userId: string,
  result: DecisionResult,
): Promise<DecisionResult> => {
  if (!result.profilingPrompt) return result

  const settings = await findSettings(userId)
  const last = settings?.lastProfilePromptAt
  if (last && Date.now() - new Date(last).getTime() < PROFILE_PROMPT_COOLDOWN_MS) {
    return { ...result, profilingPrompt: null }
  }

  await upsertSettings(userId, { lastProfilePromptAt: new Date() })
  return result
}

// Allow-list of Identity fields the profiling loop is permitted to write —
// mirrors the fields deriveProfilingPrompt in decisions.ai.ts can ask about.
// Never widen this to accept an arbitrary field name from the client.
const PROFILE_ANSWER_FIELDS = new Set([
  "identity.thisYearGoal",
  "identity.purpose",
  "identity.lifeVision",
  "identity.bigPicture",
])

export const answerProfilePromptService = async (
  userId: string,
  field: string,
  value: string,
): Promise<void> => {
  if (!PROFILE_ANSWER_FIELDS.has(field)) {
    throw new ValidationError(`Unknown or unwritable profiling field: ${field}`)
  }
  const key = field.split(".")[1] as "thisYearGoal" | "purpose" | "lifeVision" | "bigPicture"
  await upsertIdentityService(userId, { [key]: value })
}

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
  profilingPrompt: null,
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

  const result = await getDecisions(context, todayBlocks)
  return applyProfilePromptCooldown(userId, result)
}
