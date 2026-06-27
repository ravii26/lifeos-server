/* ===================================================================
   Area scoring (A2) — pure blend of the user's activity into a 0..100
   score per area. Mirrors the design prototype's formula:

     score = 0.4·taskCompletion + 0.4·habitConsistency(7d) + 0.2·learning

   This is computed on read (no stored column, no background job yet).
   When a momentum-history table lands (A3), snapshot this output daily.
   =================================================================== */
import { computeHabitStats } from "../habit/habit.stats.js"
import { dayKeyInTz, utcDayKey } from "../../shared/utils/time.util.js"

export interface ScoringInput {
  tasks: { areaId: string | null; status: string }[]
  habits: { areaId: string; logs: { date: Date; completed: boolean; minutes: number }[] }[]
  resources: {
    status: string
    lessonsCompleted?: number
    totalLessons?: number | null
    topic: { areaId: string } | null
  }[]
}

// Progress-weighted learning credit for one resource: a completed resource is
// full credit, an in-progress one earns partial credit from lessons done (or a
// flat 0.3 if it has no lesson count) — so the progress the user logs actually
// moves their area score instead of counting for nothing until completion.
const resourceCredit = (r: {
  status: string
  lessonsCompleted?: number
  totalLessons?: number | null
}): number => {
  if (r.status === "COMPLETED") return 1
  if (r.totalLessons && r.totalLessons > 0) {
    return Math.min(1, Math.max(0, (r.lessonsCompleted ?? 0) / r.totalLessons))
  }
  return r.status === "IN_PROGRESS" ? 0.3 : 0
}

export interface AreaScore {
  score: number
  tasksDone: number
  tasksTotal: number
  streak: number
  focusMins: number
}

// Neutral baselines when an area has no data of a given kind, so a brand
// new area doesn't read as 0%.
const BASE_TASK = 0.5
const BASE_HABIT = 0.5
const BASE_LEARN = 0.4

export const scoreArea = (
  areaId: string,
  input: ScoringInput,
  timeZone = "UTC",
  now: Date = new Date(),
): AreaScore => {
  // "Today" follows the user's timezone, not server UTC, so scores don't flip
  // at the wrong hour after midnight.
  const todayKey = dayKeyInTz(now, timeZone)
  // --- tasks ---
  const areaTasks = input.tasks.filter((t) => t.areaId === areaId)
  const tasksTotal = areaTasks.length
  const tasksDone = areaTasks.filter((t) => t.status === "COMPLETED").length
  const taskRate = tasksTotal ? tasksDone / tasksTotal : BASE_TASK

  // --- habits (7-day consistency + best current streak + today's minutes) ---
  const areaHabits = input.habits.filter((h) => h.areaId === areaId)
  let habitRate = BASE_HABIT
  let streak = 0
  let focusMins = 0
  if (areaHabits.length) {
    let consistencySum = 0
    for (const h of areaHabits) {
      const stats = computeHabitStats(h.logs, 7, timeZone, now)
      consistencySum += stats.history.filter(Boolean).length / 7
      if (stats.currentStreak > streak) streak = stats.currentStreak
      focusMins += h.logs
        .filter((l) => utcDayKey(l.date) === todayKey)
        .reduce((s, l) => s + (l.minutes || 0), 0)
    }
    habitRate = consistencySum / areaHabits.length
  }

  // --- learning (progress-weighted across the area's resources) ---
  const areaResources = input.resources.filter((r) => r.topic?.areaId === areaId)
  const learnFrac = areaResources.length
    ? areaResources.reduce((sum, r) => sum + resourceCredit(r), 0) / areaResources.length
    : BASE_LEARN

  const score = Math.round((0.4 * taskRate + 0.4 * habitRate + 0.2 * learnFrac) * 100)
  return { score, tasksDone, tasksTotal, streak, focusMins }
}
