import { NotFoundError } from "../../shared/utils/errors.util.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { findAreaById } from "../area/area.repository.js"
import {
  createHabit,
  findHabitsByUser,
  findHabitById,
  updateHabit,
  deleteHabit,
  upsertHabitLog,
  findHabitLogs,
} from "./habit.repository.js"
import type {
  CreateHabitDto,
  UpdateHabitDto,
  ListHabitsDto,
  LogHabitDto,
  ListLogsDto,
} from "./habit.schema.js"
import type { HabitDto, HabitLogDto } from "./habit.dto.js"

const getOwnedHabit = async (id: string, userId: string) => {
  const habit = await findHabitById(id, userId)
  if (!habit) throw new NotFoundError("Habit not found")
  return habit
}

const assertAreaOwned = async (areaId: string, userId: string) => {
  const area = await findAreaById(areaId, userId)
  if (!area) throw new NotFoundError("Area not found")
}

// Strips time to a UTC date-only value so it matches the @db.Date column
// and the [habitId, date] unique constraint regardless of timezone.
const toDateOnly = (date: Date): Date => {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export const createHabitService = async (
  userId: string,
  input: CreateHabitDto,
): Promise<HabitDto> => {
  await assertAreaOwned(input.areaId, userId)

  return createHabit({
    userId,
    areaId: input.areaId,
    title: input.title,
    description: input.description ?? null,
    habitType: input.habitType ?? "BOOLEAN",
    targetCount: input.targetCount ?? null,
    targetMinutes: input.targetMinutes ?? null,
    frequency: input.frequency ?? "DAILY",
    weeklyTarget: input.weeklyTarget ?? null,
    specificDays: input.specificDays ?? [],
    reminderTime: input.reminderTime ?? null,
    isActive: input.isActive ?? true,
  })
}

export const listHabitsService = (
  userId: string,
  filters: ListHabitsDto,
): Promise<HabitDto[]> => {
  return findHabitsByUser(userId, {
    ...(filters.areaId && { areaId: filters.areaId }),
    ...(filters.isActive && { isActive: filters.isActive === "true" }),
  })
}

export const getHabitService = (id: string, userId: string): Promise<HabitDto> => {
  return getOwnedHabit(id, userId)
}

export const updateHabitService = async (
  id: string,
  userId: string,
  input: UpdateHabitDto,
): Promise<HabitDto> => {
  await getOwnedHabit(id, userId)
  if (input.areaId) await assertAreaOwned(input.areaId, userId)
  return updateHabit(id, input)
}

export const deleteHabitService = async (id: string, userId: string): Promise<void> => {
  await getOwnedHabit(id, userId)
  await deleteHabit(id)
}

export const logHabitService = async (
  id: string,
  userId: string,
  input: LogHabitDto,
): Promise<HabitLogDto> => {
  await getOwnedHabit(id, userId)
  const date = toDateOnly(input.date ?? new Date())

  const log = await upsertHabitLog(id, userId, date, {
    completed: input.completed ?? true,
    count: input.count ?? 0,
    minutes: input.minutes ?? 0,
    notes: input.notes ?? null,
  })
  logBehavior(userId, "HABIT_LOGGED", { habitId: id })
  return log
}

export const listHabitLogsService = async (
  id: string,
  userId: string,
  range: ListLogsDto,
): Promise<HabitLogDto[]> => {
  await getOwnedHabit(id, userId)
  return findHabitLogs(id, {
    ...(range.from && { gte: toDateOnly(range.from) }),
    ...(range.to && { lte: toDateOnly(range.to) }),
  })
}
