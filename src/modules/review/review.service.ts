import type { Prisma } from "@prisma/client"
import { NotFoundError } from "../../shared/utils/errors.util.js"
import { findNoteById } from "../note/note.repository.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import { listAreasService } from "../area/area.service.js"
import { listGoalsWithConfidenceService } from "../goal/goal.service.js"
import { listHabitsService } from "../habit/habit.service.js"
import { dateFromKey, todayKeyInTz } from "../../shared/utils/time.util.js"
import {
  createReview,
  findReviewsByUser,
  findReviewById,
  updateReview,
  deleteReview,
  findReviewPeriodStats,
  createInsight,
  findInsightsByReview,
  findInsightById,
  updateInsight,
  deleteInsight,
} from "./review.repository.js"
import { generateReviewInsights } from "./review.ai.js"
import type {
  CreateReviewDto,
  UpdateReviewDto,
  ListReviewsDto,
  CreateInsightDto,
  UpdateInsightDto,
} from "./review.schema.js"
import type { ReviewDto, ReviewDraftDto, InsightReviewDto } from "./review.dto.js"

const getOwnedReview = async (id: string, userId: string) => {
  const review = await findReviewById(id, userId)
  if (!review) throw new NotFoundError("Review not found")
  return review
}

const getOwnedInsight = async (id: string, userId: string) => {
  const insight = await findInsightById(id, userId)
  if (!insight) throw new NotFoundError("Insight not found")
  return insight
}

// --- Review ---
export const createReviewService = (
  userId: string,
  input: CreateReviewDto,
): Promise<ReviewDto> => {
  return createReview({
    userId,
    reviewType: input.reviewType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    summary: input.summary ?? null,
    highlights: input.highlights ?? null,
    improvements: input.improvements ?? null,
    userNote: input.userNote ?? null,
    ...(input.aiInsights !== undefined && {
      aiInsights: input.aiInsights as Prisma.InputJsonValue,
    }),
  })
}

// --- Auto-drafted review (the "use the data properly" feature) ---

const PERIOD_DAYS: Record<string, number> = { DAILY: 1, WEEKLY: 7, MONTHLY: 30, YEARLY: 365 }
const PERIOD_LABEL: Record<string, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
}

// Generate a review pre-filled from what the user actually did over the period:
// completed tasks, habit check-ins, focus minutes, current area scores, active-
// goal confidence and top streaks — plus an AI narrative. The client shows this
// as an editable draft; saving goes through the normal POST /reviews.
export const generateReviewDraftService = async (
  userId: string,
  reviewType: string,
): Promise<ReviewDraftDto> => {
  const timeZone = await getUserTimezone(userId)
  const now = new Date()
  const days = PERIOD_DAYS[reviewType] ?? 7
  const periodEnd = now
  // Anchor on the user's local day, then walk back to cover `days` days incl. today.
  const periodStart = dateFromKey(todayKeyInTz(timeZone, now))
  periodStart.setUTCDate(periodStart.getUTCDate() - (days - 1))

  const [stats, areas, goals, habits] = await Promise.all([
    findReviewPeriodStats(userId, periodStart, periodEnd),
    listAreasService(userId),
    listGoalsWithConfidenceService(userId, { withConfidence: true, status: "ACTIVE" }),
    listHabitsService(userId, {}),
  ])

  const areaScores = areas.map((a) => ({ name: a.name, score: a.score }))
  const activeGoals = goals.flatMap((g) =>
    g.confidence
      ? [{ title: g.title, confidence: g.confidence.confidence, label: g.confidence.label }]
      : [],
  )
  const topStreaks = [...habits]
    .sort((a, b) => b.currentStreak - a.currentStreak)
    .slice(0, 3)
    .map((h) => ({ title: h.title, streak: h.currentStreak }))

  const periodLabel = PERIOD_LABEL[reviewType] ?? "week"

  const aiInsights = await generateReviewInsights({
    periodLabel,
    tasksCompleted: stats.tasksCompleted,
    habitsLogged: stats.habitsLogged,
    focusMinutes: stats.focusMinutes,
    topStreaks,
    areaScores,
    activeGoals,
  })

  // Deterministic pre-fill for the editable fields (independent of the AI).
  const bestStreak = topStreaks.find((s) => s.streak > 0)
  const weakestArea = [...areaScores].sort((a, b) => a.score - b.score)[0]

  const suggestedSummary =
    stats.tasksCompleted + stats.habitsLogged === 0
      ? `A quiet ${periodLabel}.`
      : `Completed ${stats.tasksCompleted} task(s), logged ${stats.habitsLogged} habit check-in(s)${
          stats.focusMinutes > 0 ? `, focused ${Math.round(stats.focusMinutes)} min` : ""
        }.`

  const suggestedHighlights = [
    ...stats.taskTitles.map((t) => `✓ ${t}`),
    ...(bestStreak ? [`🔥 ${bestStreak.title}: ${bestStreak.streak}-day streak`] : []),
  ].join("\n")

  const suggestedImprovements = [
    ...(weakestArea ? [`Give "${weakestArea.name}" (${weakestArea.score}/100) more attention.`] : []),
    ...activeGoals
      .filter((g) => g.label !== "ON_TRACK")
      .map((g) => `Move "${g.title}" forward (${g.label.replace("_", " ").toLowerCase()}).`),
  ].join("\n")

  return {
    reviewType,
    periodStart,
    periodEnd,
    stats: {
      tasksCompleted: stats.tasksCompleted,
      habitsLogged: stats.habitsLogged,
      focusMinutes: Math.round(stats.focusMinutes),
      topStreaks,
      areaScores,
      activeGoals,
    },
    suggestedSummary,
    suggestedHighlights,
    suggestedImprovements,
    aiInsights,
  }
}

export const listReviewsService = (
  userId: string,
  filters: ListReviewsDto,
): Promise<ReviewDto[]> => {
  return findReviewsByUser(userId, {
    ...(filters.reviewType && { reviewType: filters.reviewType }),
  })
}

export const getReviewService = (id: string, userId: string): Promise<ReviewDto> => {
  return getOwnedReview(id, userId)
}

export const updateReviewService = async (
  id: string,
  userId: string,
  input: UpdateReviewDto,
): Promise<ReviewDto> => {
  await getOwnedReview(id, userId)
  return updateReview(id, input)
}

export const deleteReviewService = async (id: string, userId: string): Promise<void> => {
  await getOwnedReview(id, userId)
  await deleteReview(id)
}

// --- InsightReview ---
export const createInsightService = async (
  reviewId: string,
  userId: string,
  input: CreateInsightDto,
): Promise<InsightReviewDto> => {
  await getOwnedReview(reviewId, userId)

  const note = await findNoteById(input.noteId, userId)
  if (!note) throw new NotFoundError("Note not found")

  return createInsight({
    userId,
    reviewId,
    noteId: input.noteId,
    status: input.status ?? "PENDING",
    userNote: input.userNote ?? null,
  })
}

export const listInsightsService = async (
  reviewId: string,
  userId: string,
): Promise<InsightReviewDto[]> => {
  await getOwnedReview(reviewId, userId)
  return findInsightsByReview(reviewId)
}

export const updateInsightService = async (
  id: string,
  userId: string,
  input: UpdateInsightDto,
): Promise<InsightReviewDto> => {
  await getOwnedInsight(id, userId)
  return updateInsight(id, input)
}

export const deleteInsightService = async (id: string, userId: string): Promise<void> => {
  await getOwnedInsight(id, userId)
  await deleteInsight(id)
}
