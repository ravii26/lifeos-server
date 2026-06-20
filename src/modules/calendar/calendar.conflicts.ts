// Overlap detection for calendar blocks.
//
// Policy (soft-warn): overlaps are never rejected — we surface them so the UI
// can warn. Two rules keep the warnings meaningful:
//   1. A planned block and an "actual" block (isActual) are MEANT to overlap
//      (you log what actually happened over what you planned), so they never
//      count as a conflict.
//   2. Two occurrences of the same recurring series never conflict with each
//      other — they're the same block on different days.
//
// Detection runs on EXPANDED occurrences (see expandRecurringBlock), so a
// recurring template is checked instance-by-instance, not as one template row.

import type { CalendarBlockDto } from "./calendar.dto.js"

// A single overlap the candidate block has with another block/occurrence.
export interface ConflictDto {
  withBlockId: string // stored block id of the other block (template id if recurring)
  withOccurrenceId: string // the other occurrence's id (virtual id for recurring instances)
  title: string
  startTime: Date
  endTime: Date
  blockType: string
  isRecurring: boolean
  occurrenceDate: Date | null // the other occurrence's series instant, if recurring
  occurrenceStartTime: Date // which instance of the candidate clashed (== startTime for one-offs)
  overlapMinutes: number
}

// A symmetric overlapping pair, for the /conflicts checker endpoint.
export interface ConflictPairDto {
  a: ConflictRef
  b: ConflictRef
  overlapMinutes: number
}

export interface ConflictRef {
  blockId: string
  occurrenceId: string
  title: string
  startTime: Date
  endTime: Date
  blockType: string
  isRecurring: boolean
  occurrenceDate: Date | null
}

// The stored identity of an occurrence: its template id if it's a recurring
// instance, otherwise its own id. Used so a series can't conflict with itself.
const seriesId = (b: CalendarBlockDto): string => b.recurringBlockId ?? b.id

const overlapMinutes = (a: CalendarBlockDto, b: CalendarBlockDto): number => {
  const ms =
    Math.min(a.endTime.getTime(), b.endTime.getTime()) -
    Math.max(a.startTime.getTime(), b.startTime.getTime())
  return ms > 0 ? Math.round(ms / 60000) : 0
}

// Do these two occurrences count as a (warn-worthy) conflict?
export const blocksConflict = (a: CalendarBlockDto, b: CalendarBlockDto): boolean => {
  if (seriesId(a) === seriesId(b)) return false // same block / same series
  if (a.isActual !== b.isActual) return false // planned vs actual is intentional
  return a.startTime < b.endTime && b.startTime < a.endTime // time overlap
}

const toRef = (b: CalendarBlockDto): ConflictRef => ({
  blockId: seriesId(b),
  occurrenceId: b.id,
  title: b.title,
  startTime: b.startTime,
  endTime: b.endTime,
  blockType: b.blockType,
  isRecurring: b.isRecurring,
  occurrenceDate: b.occurrenceDate,
})

// Conflicts of a single candidate block (by stored id) against everything else
// in the already-expanded occurrence list. `occurrences` should include the
// candidate's own occurrences (they're filtered out via seriesId).
export const conflictsForBlock = (
  candidateBlockId: string,
  occurrences: CalendarBlockDto[],
  limit = 50,
): ConflictDto[] => {
  const mine = occurrences.filter((o) => seriesId(o) === candidateBlockId)
  const others = occurrences.filter((o) => seriesId(o) !== candidateBlockId)
  const out: ConflictDto[] = []

  for (const m of mine) {
    for (const o of others) {
      if (!blocksConflict(m, o)) continue
      out.push({
        withBlockId: seriesId(o),
        withOccurrenceId: o.id,
        title: o.title,
        startTime: o.startTime,
        endTime: o.endTime,
        blockType: o.blockType,
        isRecurring: o.isRecurring,
        occurrenceDate: o.occurrenceDate,
        occurrenceStartTime: m.startTime,
        overlapMinutes: overlapMinutes(m, o),
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

// All overlapping pairs across an expanded occurrence list (sweep line).
// Input is assumed sorted by startTime ascending (listBlocksService sorts it).
export const detectConflictPairs = (
  occurrences: CalendarBlockDto[],
  limit = 200,
): ConflictPairDto[] => {
  const pairs: ConflictPairDto[] = []
  const active: CalendarBlockDto[] = []

  for (const cur of occurrences) {
    // Drop blocks that ended before this one starts — they can't overlap.
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.endTime <= cur.startTime) active.splice(i, 1)
    }
    for (const a of active) {
      if (blocksConflict(a, cur)) {
        pairs.push({ a: toRef(a), b: toRef(cur), overlapMinutes: overlapMinutes(a, cur) })
        if (pairs.length >= limit) return pairs
      }
    }
    active.push(cur)
  }
  return pairs
}
