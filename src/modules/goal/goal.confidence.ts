/* ===================================================================
   Goal confidence (the Accountability number).

   A goal is a promise. Confidence is how much the user's *actual
   behaviour* backs that promise up — a single 0..100 number that moves
   on its own as the user does (or skips) the work. This is the piece
   that makes consequences real: skip the gym and your "Get fit"
   confidence visibly drops.

     confidence = 0.45·habitConsistency(14d)
                + 0.35·taskCompletion
                + 0.20·momentum (recency of real progress)

   Pure function — all data is fetched upstream and passed in, so this
   stays testable and N+1-free (mirrors area.scoring.ts).
   =================================================================== */
import { computeHabitStats } from "../habit/habit.stats.js"
import { dayKeyInTz, utcDayKey, daysBetweenKeys } from "../../shared/utils/time.util.js"

export interface GoalConfidenceInput {
  goalId: string
  areaId: string
  deadline: Date | null
  // Tasks linked directly to this goal (goalId === goalId).
  tasks: { status: string; completedAt: Date | null }[]
  // Habits in this goal's area, each with its recent logs.
  habits: { logs: { date: Date; completed: boolean }[] }[]
}

export type ConfidenceLabel = "ON_TRACK" | "AT_RISK" | "OFF_TRACK"

export interface GoalConfidence {
  confidence: number // 0..100
  label: ConfidenceLabel
  drivers: {
    habitConsistency: number // 0..100
    taskCompletion: number // 0..100
    momentum: number // 0..100
  }
  // The single lowest driver — what the frontend should nudge the user on.
  weakest: "habits" | "tasks" | "momentum"
  // Days since the last real progress (completed task / logged habit), or null.
  daysSinceProgress: number | null
}

// Neutral baselines so a brand-new goal with no data reads ~50%, not 0%.
const BASE_HABIT = 0.5
const BASE_TASK = 0.5
const BASE_MOMENTUM = 0.5

const HABIT_WINDOW = 14

const labelFor = (c: number): ConfidenceLabel =>
  c >= 70 ? "ON_TRACK" : c >= 40 ? "AT_RISK" : "OFF_TRACK"

export const scoreGoalConfidence = (
  input: GoalConfidenceInput,
  timeZone = "UTC",
  now: Date = new Date(),
): GoalConfidence => {
  // --- task completion ---
  const tasksTotal = input.tasks.length
  const tasksDone = input.tasks.filter((t) => t.status === "COMPLETED").length
  const taskRate = tasksTotal ? tasksDone / tasksTotal : BASE_TASK

  // --- habit consistency (avg N-day completion across the area's habits) ---
  let habitRate = BASE_HABIT
  if (input.habits.length) {
    let sum = 0
    for (const h of input.habits) {
      const stats = computeHabitStats(h.logs, HABIT_WINDOW, timeZone, now)
      sum += stats.history.filter(Boolean).length / HABIT_WINDOW
    }
    habitRate = sum / input.habits.length
  }

  // --- momentum: how recently did *anything* move on this goal? ---
  // completedAt is a real instant → resolve to the user's local day; habit log
  // dates are stored date-only → read with utcDayKey.
  const progressKeys: string[] = []
  for (const t of input.tasks) if (t.completedAt) progressKeys.push(dayKeyInTz(t.completedAt, timeZone))
  for (const h of input.habits)
    for (const l of h.logs) if (l.completed) progressKeys.push(utcDayKey(l.date))

  let daysSinceProgress: number | null = null
  let momentum = BASE_MOMENTUM
  if (progressKeys.length) {
    const latestKey = progressKeys.reduce((a, b) => (a > b ? a : b))
    daysSinceProgress = Math.max(0, daysBetweenKeys(latestKey, dayKeyInTz(now, timeZone)))
    // Fresh progress (today/yesterday) → full momentum; decays ~linearly to 0
    // over two weeks of silence.
    momentum = Math.max(0, 1 - daysSinceProgress / 14)
  }

  const raw = 0.45 * habitRate + 0.35 * taskRate + 0.2 * momentum
  const confidence = Math.round(raw * 100)

  const drivers = {
    habitConsistency: Math.round(habitRate * 100),
    taskCompletion: Math.round(taskRate * 100),
    momentum: Math.round(momentum * 100),
  }

  const weakest: GoalConfidence["weakest"] =
    drivers.habitConsistency <= drivers.taskCompletion &&
    drivers.habitConsistency <= drivers.momentum
      ? "habits"
      : drivers.taskCompletion <= drivers.momentum
        ? "tasks"
        : "momentum"

  return {
    confidence,
    label: labelFor(confidence),
    drivers,
    weakest,
    daysSinceProgress,
  }
}
