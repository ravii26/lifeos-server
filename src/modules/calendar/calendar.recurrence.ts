import pkg from "rrule"
import type { RRule as RRuleClass } from "rrule"
// rrule ships as CommonJS, so named ESM imports fail at runtime under NodeNext.
const { RRule, rrulestr } = pkg
import type { CalendarBlock, CalendarBlockException } from "@prisma/client"
import { ValidationError } from "../../shared/utils/errors.util.js"
import logger from "../../lib/logger.js"
import type { CalendarBlockDto } from "./calendar.dto.js"

// Hard cap so a malformed/unbounded rule can never expand forever.
const MAX_OCCURRENCES = 1000

// Validate an iCal RRULE string up front so we fail at write time, not list time.
export const assertValidRecurrenceRule = (rule: string, dtstart: Date): void => {
  try {
    rrulestr(rule, { dtstart })
  } catch (err) {
    logger.warn(`assertValidRecurrenceRule: rejected malformed RRULE "${rule}":`, err)
    throw new ValidationError("Invalid recurrenceRule (expected an iCal RRULE string)")
  }
}

// Cap a recurring rule so it stops before `until`, used when splitting a series
// ("this and following"): the original block keeps every occurrence < boundary.
// Returns a bare RRULE string (no DTSTART line — dtstart lives on the block row).
export const capRecurrenceRule = (rule: string, dtstart: Date, until: Date): string => {
  const parsed = rrulestr(rule, { dtstart })
  const opts = (parsed as RRuleClass).origOptions
  // Drop dtstart from the output and clear count (UNTIL and COUNT are exclusive).
  const capped = new RRule({ ...opts, dtstart: null, count: null, until })
  return capped
    .toString()
    .split("\n")
    .find((line) => line.startsWith("RRULE:"))!
    .replace(/^RRULE:/, "")
}

const toDto = (block: CalendarBlock): CalendarBlockDto => ({
  id: block.id,
  taskId: block.taskId,
  habitId: block.habitId,
  areaId: block.areaId,
  title: block.title,
  startTime: block.startTime,
  endTime: block.endTime,
  blockType: block.blockType,
  isActual: block.isActual,
  notes: block.notes,
  recurrenceRule: block.recurrenceRule,
  isRecurring: block.recurrenceRule !== null,
  // A stored row is never itself a generated occurrence.
  recurringBlockId: null,
  occurrenceDate: null,
  createdAt: block.createdAt,
  updatedAt: block.updatedAt,
})

// Expand a recurring template into concrete (virtual) occurrences within [from, to],
// applying any per-occurrence exceptions (cancellations + field overrides).
export const expandRecurringBlock = (
  block: CalendarBlock & { exceptions: CalendarBlockException[] },
  from: Date,
  to: Date,
): CalendarBlockDto[] => {
  const rule = rrulestr(block.recurrenceRule!, { dtstart: block.startTime })
  const durationMs = block.endTime.getTime() - block.startTime.getTime()

  // Index exceptions by the occurrence instant they pin to.
  const exceptionByInstant = new Map<number, CalendarBlockException>()
  for (const ex of block.exceptions) {
    exceptionByInstant.set(ex.occurrenceDate.getTime(), ex)
  }

  const starts = rule.between(from, to, true).slice(0, MAX_OCCURRENCES)
  const occurrences: CalendarBlockDto[] = []

  for (const occStart of starts) {
    const ex = exceptionByInstant.get(occStart.getTime())
    if (ex?.isCancelled) continue

    const start = ex?.startTime ?? occStart
    const end = ex?.endTime ?? new Date(occStart.getTime() + durationMs)

    occurrences.push({
      id: `${block.id}:${occStart.toISOString()}`,
      taskId: block.taskId,
      habitId: block.habitId,
      areaId: block.areaId,
      title: ex?.title ?? block.title,
      startTime: start,
      endTime: end,
      blockType: ex?.blockType ?? block.blockType,
      isActual: block.isActual,
      notes: ex?.notes ?? block.notes,
      recurrenceRule: block.recurrenceRule,
      isRecurring: true,
      recurringBlockId: block.id,
      occurrenceDate: occStart,
      createdAt: block.createdAt,
      updatedAt: block.updatedAt,
    })
  }

  return occurrences
}

export const blockToDto = toDto
