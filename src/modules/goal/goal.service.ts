import { NotFoundError, ConflictError } from "../../shared/utils/errors.util.js"
import { findAreaById } from "../area/area.repository.js"
import {
  createGoal,
  findGoalsByUser,
  countGoalsByUser,
  findGoalById,
  updateGoal,
  deleteGoal,
  countActiveGoals,
  findActiveGoals,
  swapActiveGoal,
  findGoalScoringData,
} from "./goal.repository.js"
import { scoreGoalConfidence } from "./goal.confidence.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import { getPagination, paginatedResponse } from "../../shared/utils/pagination.util.js"
import type {
  CreateGoalDto,
  UpdateGoalDto,
  ListGoalsDto,
} from "./goal.schema.js"
import type {
  GoalDto,
  GoalWithConfidenceDto,
  FocusStateDto,
  GoalBoardDto,
} from "./goal.dto.js"

/**
 * The core constraint that makes LifeOS a decision engine and not just a list:
 * a user may only pursue a small number of goals at once. Everything else is
 * PARKED. Two is the sweet spot — enough to balance (e.g. career + health),
 * few enough to prevent the "15 active projects, zero progress" trap.
 */
export const MAX_ACTIVE_GOALS = 2

const HABIT_WINDOW_DAYS = 14

const getOwnedGoal = async (id: string, userId: string) => {
  const goal = await findGoalById(id, userId)
  if (!goal) throw new NotFoundError("Goal not found")
  return goal
}

const assertAreaOwned = async (areaId: string, userId: string) => {
  const area = await findAreaById(areaId, userId)
  if (!area) throw new NotFoundError("Area not found")
}

// Build the 409 payload the frontend uses to render "you're focusing on 2
// things — which do you want to park?". The error carries the active goals so
// the client needs no extra request.
const tooManyActive = async (userId: string) => {
  const activeGoals = await findActiveGoals(userId)
  return new ConflictError(
    `You can only focus on ${MAX_ACTIVE_GOALS} goals at once. Park one to make room.`,
    {
      reason: "MAX_ACTIVE_GOALS_REACHED",
      maxActive: MAX_ACTIVE_GOALS,
      activeGoals,
    },
  )
}

export const createGoalService = async (
  userId: string,
  input: CreateGoalDto,
): Promise<GoalDto> => {
  await assertAreaOwned(input.areaId, userId)

  // New goals default to PARKED so the active set is always a deliberate
  // choice. Only honour an explicit ACTIVE if there's a free slot.
  const wantsActive = (input.status ?? "PARKED") === "ACTIVE"
  if (wantsActive && (await countActiveGoals(userId)) >= MAX_ACTIVE_GOALS) {
    throw await tooManyActive(userId)
  }

  const status = input.status ?? "PARKED"
  const now = new Date()
  return createGoal({
    userId,
    areaId: input.areaId,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority ?? "MEDIUM",
    status,
    deadline: input.deadline ?? null,
    activatedAt: status === "ACTIVE" ? now : null,
    parkedAt: status === "PARKED" ? now : null,
  })
}

export const listGoalsService = async (
  userId: string,
  filters: ListGoalsDto,
): Promise<GoalDto[] | ReturnType<typeof paginatedResponse>> => {
  const where = {
    ...(filters.areaId && { areaId: filters.areaId }),
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
  }

  if (filters.page || filters.limit) {
    const params = getPagination(filters.page, filters.limit)
    const [items, total] = await Promise.all([
      findGoalsByUser(userId, where, params.skip, params.limit),
      countGoalsByUser(userId, where),
    ])
    return paginatedResponse(items, total, params)
  }

  return findGoalsByUser(userId, where)
}

// Attach a live confidence number to a set of goals with a single batched
// scoring pull (no N+1). Shared by the confidence list and the focus board.
const enrichWithConfidence = async (
  userId: string,
  goals: GoalDto[],
): Promise<GoalWithConfidenceDto[]> => {
  if (!goals.length) return []

  const since = new Date()
  since.setUTCDate(since.getUTCDate() - HABIT_WINDOW_DAYS)
  const goalIds = goals.map((g) => g.id)
  const areaIds = [...new Set(goals.map((g) => g.areaId))]
  const [timeZone, { tasks, habits }] = await Promise.all([
    getUserTimezone(userId),
    findGoalScoringData(userId, goalIds, areaIds, since),
  ])

  return goals.map((g) => ({
    ...g,
    confidence: scoreGoalConfidence(
      {
        goalId: g.id,
        areaId: g.areaId,
        deadline: g.deadline,
        tasks: tasks.filter((t) => t.goalId === g.id),
        habits: habits.filter((h) => h.areaId === g.areaId),
      },
      timeZone,
    ),
  }))
}

// Same list, enriched with each goal's live confidence number. Kept separate
// from listGoalsService so plain lists stay cheap; this one does the scoring
// pull. Powers the focus board where the numbers must be visible.
export const listGoalsWithConfidenceService = async (
  userId: string,
  filters: ListGoalsDto,
): Promise<GoalWithConfidenceDto[] | ReturnType<typeof paginatedResponse>> => {
  const where = {
    ...(filters.areaId && { areaId: filters.areaId }),
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
  }

  if (filters.page || filters.limit) {
    const params = getPagination(filters.page, filters.limit)
    const [goals, total] = await Promise.all([
      findGoalsByUser(userId, where, params.skip, params.limit),
      countGoalsByUser(userId, where),
    ])
    const enriched = await enrichWithConfidence(userId, goals)
    return paginatedResponse(enriched, total, params)
  }

  const goals = await findGoalsByUser(userId, where)
  return enrichWithConfidence(userId, goals)
}

// The single payload behind the daily focus screen: the active goals (with
// confidence), the parked backlog (with confidence), and how many active slots
// are free — all in one request so the UI never has to stitch three calls.
export const getGoalBoardService = async (userId: string): Promise<GoalBoardDto> => {
  const goals = await findGoalsByUser(userId)
  const scored = await enrichWithConfidence(userId, goals)

  const active = scored.filter((g) => g.status === "ACTIVE")
  const parked = scored.filter((g) => g.status === "PARKED")

  return {
    active,
    parked,
    maxActive: MAX_ACTIVE_GOALS,
    slotsRemaining: Math.max(0, MAX_ACTIVE_GOALS - active.length),
  }
}

export const getGoalService = (id: string, userId: string): Promise<GoalDto> => {
  return getOwnedGoal(id, userId)
}

// Single-goal confidence (e.g. the goal detail screen).
export const getGoalConfidenceService = async (
  id: string,
  userId: string,
): Promise<GoalWithConfidenceDto> => {
  const goal = await getOwnedGoal(id, userId)
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - HABIT_WINDOW_DAYS)
  const [timeZone, { tasks, habits }] = await Promise.all([
    getUserTimezone(userId),
    findGoalScoringData(userId, [goal.id], [goal.areaId], since),
  ])
  return {
    ...goal,
    confidence: scoreGoalConfidence(
      {
        goalId: goal.id,
        areaId: goal.areaId,
        deadline: goal.deadline,
        tasks,
        habits,
      },
      timeZone,
    ),
  }
}

export const updateGoalService = async (
  id: string,
  userId: string,
  input: UpdateGoalDto,
): Promise<GoalDto> => {
  const existing = await getOwnedGoal(id, userId)
  if (input.areaId) await assertAreaOwned(input.areaId, userId)

  // Guard the cap on plain status edits too — but only when actually
  // transitioning *into* ACTIVE from a non-active state.
  if (
    input.status === "ACTIVE" &&
    existing.status !== "ACTIVE" &&
    (await countActiveGoals(userId)) >= MAX_ACTIVE_GOALS
  ) {
    throw await tooManyActive(userId)
  }

  // Keep the focus timestamps coherent with any status change.
  const data: Record<string, unknown> = { ...input }
  if (input.status === "ACTIVE" && existing.status !== "ACTIVE") {
    data.activatedAt = new Date()
    data.parkedAt = null
  } else if (input.status === "PARKED" && existing.status !== "PARKED") {
    data.parkedAt = new Date()
  }

  await updateGoal(id, userId, data)
  return getOwnedGoal(id, userId)
}

export const deleteGoalService = async (id: string, userId: string): Promise<void> => {
  await getOwnedGoal(id, userId)
  await deleteGoal(id, userId)
}

/* --- Focus management endpoints --- */

const buildFocusState = async (userId: string, changed: GoalDto): Promise<FocusStateDto> => {
  const activeGoals = await findActiveGoals(userId)
  return {
    goal: changed,
    activeGoals,
    maxActive: MAX_ACTIVE_GOALS,
    slotsRemaining: Math.max(0, MAX_ACTIVE_GOALS - activeGoals.length),
  }
}

/**
 * Activate a goal, enforcing the focus cap.
 *  - already ACTIVE        → no-op, returns current state
 *  - free slot             → activate
 *  - full + parkGoalId     → atomic swap (park that one, activate this)
 *  - full + no parkGoalId  → 409 with the active goals, so the UI can ask
 *                            "which do you want to park?"
 */
export const activateGoalService = async (
  id: string,
  userId: string,
  parkGoalId?: string,
): Promise<FocusStateDto> => {
  const goal = await getOwnedGoal(id, userId)
  if (goal.status === "ACTIVE") return buildFocusState(userId, goal)

  const activeCount = await countActiveGoals(userId)

  if (activeCount < MAX_ACTIVE_GOALS) {
    await updateGoal(id, userId, {
      status: "ACTIVE",
      activatedAt: new Date(),
      parkedAt: null,
    })
    const updated = await getOwnedGoal(id, userId)
    return buildFocusState(userId, updated)
  }

  // Full — need to park something.
  if (!parkGoalId) throw await tooManyActive(userId)

  const toPark = await getOwnedGoal(parkGoalId, userId)
  if (toPark.status !== "ACTIVE") {
    throw new ConflictError("The goal you chose to park is not currently active", {
      reason: "PARK_TARGET_NOT_ACTIVE",
      parkGoalId,
    })
  }

  await swapActiveGoal(id, parkGoalId, userId)
  const activated = await getOwnedGoal(id, userId)
  return buildFocusState(userId, activated)
}

// Park a goal — pull it out of the active set without losing it.
export const parkGoalService = async (
  id: string,
  userId: string,
): Promise<FocusStateDto> => {
  const goal = await getOwnedGoal(id, userId)
  if (goal.status === "PARKED") return buildFocusState(userId, goal)

  await updateGoal(id, userId, { status: "PARKED", parkedAt: new Date() })
  const updated = await getOwnedGoal(id, userId)
  return buildFocusState(userId, updated)
}
