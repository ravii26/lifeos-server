import { NotFoundError } from "../../shared/utils/errors.util.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { findAreaById } from "../area/area.repository.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import { todayKeyInTz, utcDayKey, localDateOnly } from "../../shared/utils/time.util.js"
import {
  createHabit,
  findHabitsByUser,
  findHabitsWithLogsByUser,
  findHabitById,
  updateHabit,
  deleteHabit,
  upsertHabitLog,
  findHabitLogs,
} from "./habit.repository.js"
import { computeHabitStats } from "./habit.stats.js"
import type {
  CreateHabitDto,
  UpdateHabitDto,
  ListHabitsDto,
  LogHabitDto,
  ListLogsDto,
} from "./habit.schema.js"
import type { HabitDto, HabitLogDto, HabitWithStatsDto } from "./habit.dto.js"

// How many trailing days of logs to load + expose for stats/heat-strips.
const STATS_WINDOW = 28

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

export const listHabitsService = async (
  userId: string,
  filters: ListHabitsDto,
): Promise<HabitWithStatsDto[]> => {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - STATS_WINDOW)

  const [timeZone, habits] = await Promise.all([
    getUserTimezone(userId),
    findHabitsWithLogsByUser(userId, since, {
      ...(filters.areaId && { areaId: filters.areaId }),
      ...(filters.isActive && { isActive: filters.isActive === "true" }),
    }),
  ])

  const tk = todayKeyInTz(timeZone)
  return habits.map(({ logs, ...habit }) => {
    const stats = computeHabitStats(logs, STATS_WINDOW, timeZone)
    const todayLog = logs.find((l) => utcDayKey(l.date) === tk) ?? null
    return { ...habit, ...stats, todayLog }
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
  // A logged-for-now entry lands on the user's LOCAL day; an explicit date the
  // client sends is treated as the calendar date it already is.
  const date = input.date
    ? toDateOnly(input.date)
    : localDateOnly(new Date(), await getUserTimezone(userId))

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
