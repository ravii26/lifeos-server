import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { findAreaById } from "../area/area.repository.js"
import { findTaskById } from "../task/task.repository.js"
import { findHabitById } from "../habit/habit.repository.js"
import {
  createBlock,
  findBlocksByUser,
  findBlockById,
  updateBlock,
  deleteBlock,
  upsertException,
  deleteException,
  reassignExceptions,
} from "./calendar.repository.js"
import {
  expandRecurringBlock,
  blockToDto,
  assertValidRecurrenceRule,
  capRecurrenceRule,
} from "./calendar.recurrence.js"
import { conflictsForBlock, detectConflictPairs } from "./calendar.conflicts.js"
import type { ConflictDto, ConflictPairDto } from "./calendar.conflicts.js"
import type {
  CreateBlockDto,
  UpdateBlockDto,
  ListBlocksDto,
  ListConflictsDto,
  UpsertExceptionDto,
  SplitSeriesDto,
} from "./calendar.schema.js"
import type { CalendarBlockDto, CalendarBlockExceptionDto } from "./calendar.dto.js"
import type { CalendarBlock } from "@prisma/client"

// A block plus the (non-fatal) overlaps it has with other blocks — soft-warn.
export type CalendarBlockWithConflictsDto = CalendarBlockDto & { conflicts: ConflictDto[] }

// Window to scan when checking a saved block for overlaps: its own span for a
// one-off, or the default expansion horizon for a recurring template.
const computeBlockConflicts = async (
  userId: string,
  block: CalendarBlock,
): Promise<ConflictDto[]> => {
  const from = block.startTime
  const to = block.recurrenceRule
    ? new Date(block.startTime.getTime() + DEFAULT_WINDOW_DAYS * DAY_MS)
    : block.endTime
  const occurrences = await listBlocksService(userId, { from, to })
  return conflictsForBlock(block.id, occurrences)
}

// Default expansion window (days) when a recurring block is listed without a range.
const DEFAULT_WINDOW_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

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
): Promise<CalendarBlockWithConflictsDto> => {
  await assertLinksOwned(userId, input)

  if (input.recurrenceRule) {
    assertValidRecurrenceRule(input.recurrenceRule, input.startTime)
  }

  const block = await createBlock({
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
    recurrenceRule: input.recurrenceRule ?? null,
  })
  const conflicts = await computeBlockConflicts(userId, block)
  return { ...blockToDto(block), conflicts }
}

export const listBlocksService = async (
  userId: string,
  filters: ListBlocksDto,
): Promise<CalendarBlockDto[]> => {
  const blocks = await findBlocksByUser(userId, {
    ...(filters.areaId && { areaId: filters.areaId }),
    ...(filters.taskId && { taskId: filters.taskId }),
    ...(filters.habitId && { habitId: filters.habitId }),
  })

  const hasRange = Boolean(filters.from || filters.to)
  const from = filters.from ?? new Date()
  const to = filters.to ?? new Date(from.getTime() + DEFAULT_WINDOW_DAYS * DAY_MS)

  const result: CalendarBlockDto[] = []
  for (const block of blocks) {
    if (block.recurrenceRule) {
      // Recurring templates are always expanded within the (resolved) window.
      result.push(...expandRecurringBlock(block, from, to))
    } else if (hasRange) {
      // One-off block: keep it if it overlaps the requested range.
      if (block.endTime >= from && block.startTime <= to) result.push(blockToDto(block))
    } else {
      result.push(blockToDto(block))
    }
  }

  result.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
  return result
}

export const getBlockService = async (
  id: string,
  userId: string,
): Promise<CalendarBlockDto> => {
  const block = await getOwnedBlock(id, userId)
  return blockToDto(block)
}

export const updateBlockService = async (
  id: string,
  userId: string,
  input: UpdateBlockDto,
): Promise<CalendarBlockWithConflictsDto> => {
  const existing = await getOwnedBlock(id, userId)
  await assertLinksOwned(userId, input)

  if (input.recurrenceRule) {
    const dtstart = input.startTime ?? existing.startTime
    assertValidRecurrenceRule(input.recurrenceRule, dtstart)
  }

  const block = await updateBlock(id, input)
  const conflicts = await computeBlockConflicts(userId, block)
  return { ...blockToDto(block), conflicts }
}

export const deleteBlockService = async (id: string, userId: string): Promise<void> => {
  await getOwnedBlock(id, userId)
  await deleteBlock(id)
}

// On-demand overlap checker for a window. Expands all blocks (recurring
// included) and returns every overlapping pair. Defaults to a 90-day horizon.
export const listConflictsService = async (
  userId: string,
  filters: ListConflictsDto,
): Promise<ConflictPairDto[]> => {
  const from = filters.from ?? new Date()
  const to = filters.to ?? new Date(from.getTime() + DEFAULT_WINDOW_DAYS * DAY_MS)
  const occurrences = await listBlocksService(userId, {
    from,
    to,
    ...(filters.areaId && { areaId: filters.areaId }),
  })
  return detectConflictPairs(occurrences)
}

// --- Per-occurrence overrides ----------------------------------------------

export const upsertExceptionService = async (
  blockId: string,
  userId: string,
  input: UpsertExceptionDto,
): Promise<CalendarBlockExceptionDto> => {
  const block = await getOwnedBlock(blockId, userId)
  if (!block.recurrenceRule) {
    throw new ValidationError("Cannot add an occurrence override to a non-recurring block")
  }

  const exception = await upsertException(blockId, input.occurrenceDate, {
    isCancelled: input.isCancelled ?? false,
    title: input.title ?? null,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    blockType: input.blockType ?? null,
    notes: input.notes ?? null,
  })
  return exception
}

export const deleteExceptionService = async (
  blockId: string,
  userId: string,
  occurrenceDate: Date,
): Promise<void> => {
  await getOwnedBlock(blockId, userId)
  await deleteException(blockId, occurrenceDate)
}

// "This and following": cap the original series just before fromOccurrenceDate and
// spin off a new recurring block (with any overrides) for that occurrence onward.
export const splitSeriesService = async (
  blockId: string,
  userId: string,
  input: SplitSeriesDto,
): Promise<{ previous: CalendarBlockDto; following: CalendarBlockDto }> => {
  const original = await getOwnedBlock(blockId, userId)
  if (!original.recurrenceRule) {
    throw new ValidationError("Cannot split a non-recurring block")
  }
  await assertLinksOwned(userId, input)

  // The new series' first occurrence defines its time-of-day and duration.
  const newStart = input.startTime ?? input.fromOccurrenceDate
  const originalDurationMs = original.endTime.getTime() - original.startTime.getTime()
  const newEnd = input.endTime ?? new Date(newStart.getTime() + originalDurationMs)
  // Unchanged → reuse the original rule (preserving its own UNTIL/COUNT, if any).
  const newRule = input.recurrenceRule ?? original.recurrenceRule
  assertValidRecurrenceRule(newRule, newStart)

  // Cap the original series to everything strictly before the split point.
  const cappedUntil = new Date(input.fromOccurrenceDate.getTime() - 1000)
  const cappedRule = capRecurrenceRule(
    original.recurrenceRule,
    original.startTime,
    cappedUntil,
  )

  const previous = await updateBlock(blockId, { recurrenceRule: cappedRule })

  const following = await createBlock({
    userId,
    taskId: input.taskId !== undefined ? input.taskId : original.taskId,
    habitId: input.habitId !== undefined ? input.habitId : original.habitId,
    areaId: input.areaId !== undefined ? input.areaId : original.areaId,
    title: input.title ?? original.title,
    startTime: newStart,
    endTime: newEnd,
    blockType: input.blockType ?? original.blockType,
    isActual: original.isActual,
    notes: input.notes !== undefined ? input.notes : original.notes,
    recurrenceRule: newRule,
  })

  // Overrides on/after the split point belong to the new series.
  await reassignExceptions(blockId, following.id, input.fromOccurrenceDate)

  return { previous: blockToDto(previous), following: blockToDto(following) }
}
