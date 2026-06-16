import { NotFoundError } from "../../shared/utils/errors.util.js"
import { findAreaById } from "../area/area.repository.js"
import { findTaskById } from "../task/task.repository.js"
import { findHabitById } from "../habit/habit.repository.js"
import {
  createBlock,
  findBlocksByUser,
  findBlockById,
  updateBlock,
  deleteBlock,
} from "./calendar.repository.js"
import type { CreateBlockDto, UpdateBlockDto, ListBlocksDto } from "./calendar.schema.js"
import type { CalendarBlockDto } from "./calendar.dto.js"

const getOwnedBlock = async (id: string, userId: string) => {
  const block = await findBlockById(id, userId)
  if (!block) throw new NotFoundError("Calendar block not found")
  return block
}

// Validates any linked parent (task/habit/area) belongs to the user.
const assertLinksOwned = async (
  userId: string,
  links: { taskId?: string | null; habitId?: string | null; areaId?: string | null },
) => {
  if (links.taskId) {
    const task = await findTaskById(links.taskId, userId)
    if (!task) throw new NotFoundError("Task not found")
  }
  if (links.habitId) {
    const habit = await findHabitById(links.habitId, userId)
    if (!habit) throw new NotFoundError("Habit not found")
  }
  if (links.areaId) {
    const area = await findAreaById(links.areaId, userId)
    if (!area) throw new NotFoundError("Area not found")
  }
}

export const createBlockService = async (
  userId: string,
  input: CreateBlockDto,
): Promise<CalendarBlockDto> => {
  await assertLinksOwned(userId, input)

  return createBlock({
    userId,
    taskId: input.taskId ?? null,
    habitId: input.habitId ?? null,
    areaId: input.areaId ?? null,
    title: input.title,
    startTime: input.startTime,
    endTime: input.endTime,
    blockType: input.blockType ?? "FOCUS",
    isActual: input.isActual ?? false,
    notes: input.notes ?? null,
  })
}

export const listBlocksService = (
  userId: string,
  filters: ListBlocksDto,
): Promise<CalendarBlockDto[]> => {
  const timeRange: { gte?: Date; lte?: Date } = {}
  if (filters.from) timeRange.gte = filters.from
  if (filters.to) timeRange.lte = filters.to

  return findBlocksByUser(userId, {
    ...(Object.keys(timeRange).length && { startTime: timeRange }),
    ...(filters.areaId && { areaId: filters.areaId }),
    ...(filters.taskId && { taskId: filters.taskId }),
    ...(filters.habitId && { habitId: filters.habitId }),
  })
}

export const getBlockService = (id: string, userId: string): Promise<CalendarBlockDto> => {
  return getOwnedBlock(id, userId)
}

export const updateBlockService = async (
  id: string,
  userId: string,
  input: UpdateBlockDto,
): Promise<CalendarBlockDto> => {
  await getOwnedBlock(id, userId)
  await assertLinksOwned(userId, input)
  return updateBlock(id, input)
}

export const deleteBlockService = async (id: string, userId: string): Promise<void> => {
  await getOwnedBlock(id, userId)
  await deleteBlock(id)
}
