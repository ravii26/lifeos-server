import { NotFoundError, ConflictError } from "../../shared/utils/errors.util.js"
import { logBehavior } from "../behavior/behavior.service.js"
import { getUserTimezone } from "../auth/auth.repository.js"
import { findTaskById } from "../task/task.repository.js"
import { findHabitById } from "../habit/habit.repository.js"
import { findBlockById } from "../calendar/calendar.repository.js"
import {
  createSession,
  findSessionsByUser,
  findSessionById,
  findSessionsOverlapping,
  updateSession,
  deleteSession,
} from "./focus.repository.js"
import { aggregateDailyFocus, type DailyFocusBucket } from "./focus.daily.js"
import type { StartFocusDto, UpdateFocusDto, ListFocusDto, DailyFocusDto } from "./focus.schema.js"
import type { FocusSessionDto } from "./focus.dto.js"

const getOwnedSession = async (id: string, userId: string) => {
  const session = await findSessionById(id, userId)
  if (!session) throw new NotFoundError("Focus session not found")
  return session
}

const assertLinksOwned = async (
  userId: string,
  links: { taskId?: string | null; habitId?: string | null; calendarBlockId?: string | null },
) => {
  if (links.taskId) {
    const task = await findTaskById(links.taskId, userId)
    if (!task) throw new NotFoundError("Task not found")
  }
  if (links.habitId) {
    const habit = await findHabitById(links.habitId, userId)
    if (!habit) throw new NotFoundError("Habit not found")
  }
  if (links.calendarBlockId) {
    const block = await findBlockById(links.calendarBlockId, userId)
    if (!block) throw new NotFoundError("Calendar block not found")
  }
}

export const startFocusService = async (
  userId: string,
  input: StartFocusDto,
): Promise<FocusSessionDto> => {
  await assertLinksOwned(userId, input)

  const session = await createSession({
    userId,
    startedAt: input.startedAt ?? new Date(),
    taskId: input.taskId ?? null,
    habitId: input.habitId ?? null,
    calendarBlockId: input.calendarBlockId ?? null,
    notes: input.notes ?? null,
  })
  logBehavior(userId, "FOCUS_STARTED", { focusId: session.id })
  return session
}

// Stops a running session: records endedAt and the elapsed minutes.
export const stopFocusService = async (
  id: string,
  userId: string,
): Promise<FocusSessionDto> => {
  const session = await getOwnedSession(id, userId)
  if (session.endedAt) throw new ConflictError("Focus session already stopped")

  const endedAt = new Date()
  const durationMinutes = Math.max(
    0,
    Math.round((endedAt.getTime() - session.startedAt.getTime()) / 60000),
  )

  const stopped = await updateSession(id, { endedAt, durationMinutes })
  logBehavior(userId, "FOCUS_COMPLETED", { focusId: id, durationMinutes })
  return stopped
}

export const listFocusService = (
  userId: string,
  filters: ListFocusDto,
): Promise<FocusSessionDto[]> => {
  const timeRange: { gte?: Date; lte?: Date } = {}
  if (filters.from) timeRange.gte = filters.from
  if (filters.to) timeRange.lte = filters.to

  return findSessionsByUser(userId, {
    ...(Object.keys(timeRange).length && { startedAt: timeRange }),
    ...(filters.taskId && { taskId: filters.taskId }),
    ...(filters.habitId && { habitId: filters.habitId }),
  })
}

export const getFocusService = (id: string, userId: string): Promise<FocusSessionDto> => {
  return getOwnedSession(id, userId)
}

// Per-day focus minutes, splitting sessions that cross midnight across the
// days they actually span. Defaults to the last 7 days (UTC) when no range
// is given. Days with zero focus are omitted from the result.
export const dailyFocusService = async (
  userId: string,
  filters: DailyFocusDto,
): Promise<DailyFocusBucket[]> => {
  const to = filters.to ?? new Date()
  const from = filters.from ?? new Date(to.getTime() - 7 * 86_400_000)

  const [timeZone, sessions] = await Promise.all([
    getUserTimezone(userId),
    findSessionsOverlapping(userId, from, to, {
      ...(filters.taskId && { taskId: filters.taskId }),
      ...(filters.habitId && { habitId: filters.habitId }),
    }),
  ])

  return aggregateDailyFocus(sessions, from, to, timeZone)
}

export const updateFocusService = async (
  id: string,
  userId: string,
  input: UpdateFocusDto,
): Promise<FocusSessionDto> => {
  await getOwnedSession(id, userId)
  await assertLinksOwned(userId, input)
  return updateSession(id, input)
}

export const deleteFocusService = async (id: string, userId: string): Promise<void> => {
  const session = await getOwnedSession(id, userId)
  await deleteSession(id)
  // A session deleted while still running was abandoned — record it so the
  // behaviour analytics can surface "started but didn't finish".
  if (!session.endedAt) {
    logBehavior(userId, "FOCUS_ABANDONED", { focusId: id })
  }
}
