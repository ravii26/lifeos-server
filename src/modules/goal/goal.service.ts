import { NotFoundError } from "../../shared/utils/errors.util.js"
import { findAreaById } from "../area/area.repository.js"
import {
  createGoal,
  findGoalsByUser,
  findGoalById,
  updateGoal,
  deleteGoal,
} from "./goal.repository.js"
import type { CreateGoalDto, UpdateGoalDto, ListGoalsDto } from "./goal.schema.js"
import type { GoalDto } from "./goal.dto.js"

const getOwnedGoal = async (id: string, userId: string) => {
  const goal = await findGoalById(id, userId)
  if (!goal) throw new NotFoundError("Goal not found")
  return goal
}

const assertAreaOwned = async (areaId: string, userId: string) => {
  const area = await findAreaById(areaId, userId)
  if (!area) throw new NotFoundError("Area not found")
}

export const createGoalService = async (
  userId: string,
  input: CreateGoalDto,
): Promise<GoalDto> => {
  await assertAreaOwned(input.areaId, userId)

  return createGoal({
    userId,
    areaId: input.areaId,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority ?? "MEDIUM",
    status: input.status ?? "ACTIVE",
    deadline: input.deadline ?? null,
  })
}

export const listGoalsService = (
  userId: string,
  filters: ListGoalsDto,
): Promise<GoalDto[]> => {
  return findGoalsByUser(userId, {
    ...(filters.areaId && { areaId: filters.areaId }),
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
  })
}

export const getGoalService = (id: string, userId: string): Promise<GoalDto> => {
  return getOwnedGoal(id, userId)
}

export const updateGoalService = async (
  id: string,
  userId: string,
  input: UpdateGoalDto,
): Promise<GoalDto> => {
  await getOwnedGoal(id, userId)
  if (input.areaId) await assertAreaOwned(input.areaId, userId)
  return updateGoal(id, input)
}

export const deleteGoalService = async (id: string, userId: string): Promise<void> => {
  await getOwnedGoal(id, userId)
  await deleteGoal(id)
}
