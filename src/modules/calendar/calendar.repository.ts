import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createBlock = (data: Prisma.CalendarBlockUncheckedCreateInput) => {
  return prisma.calendarBlock.create({ data })
}

// Includes exceptions so the service can expand recurring templates in one pass.
// When a window is given, one-off blocks are scoped to those overlapping it at
// the DB level (recurring templates always pass through — their own startTime
// may predate the window yet still produce occurrences inside it; the service
// expands and windows those separately). Without this, a one-off-block table
// that only ever grows would be fetched in full on every list call.
export const findBlocksByUser = (
  userId: string,
  filters: Prisma.CalendarBlockWhereInput = {},
  window?: { from: Date; to: Date },
) => {
  return prisma.calendarBlock.findMany({
    where: {
      userId,
      ...filters,
      ...(window
        ? {
            OR: [
              { recurrenceRule: { not: null } },
              { endTime: { gte: window.from }, startTime: { lte: window.to } },
            ],
          }
        : {}),
    },
    orderBy: { startTime: "asc" },
    include: { exceptions: true },
  })
}

export const findBlockById = (id: string, userId: string) => {
  return prisma.calendarBlock.findFirst({
    where: { id, userId },
    include: { exceptions: true },
  })
}

export const updateBlock = (
  id: string,
  userId: string,
  data: Prisma.CalendarBlockUpdateInput,
) => {
  return prisma.calendarBlock.updateMany({ where: { id, userId }, data })
}

export const deleteBlock = (id: string, userId: string) => {
  return prisma.calendarBlock.deleteMany({ where: { id, userId } })
}

// --- Per-occurrence exceptions ---------------------------------------------

export const upsertException = (
  blockId: string,
  occurrenceDate: Date,
  data: Omit<Prisma.CalendarBlockExceptionUncheckedCreateInput, "blockId" | "occurrenceDate">,
) => {
  return prisma.calendarBlockException.upsert({
    where: { blockId_occurrenceDate: { blockId, occurrenceDate } },
    create: { blockId, occurrenceDate, ...data },
    update: data,
  })
}

export const deleteException = (blockId: string, occurrenceDate: Date) => {
  return prisma.calendarBlockException.deleteMany({
    where: { blockId, occurrenceDate },
  })
}

// Move overrides at/after `fromDate` onto a new block when a series is split.
export const reassignExceptions = (
  fromBlockId: string,
  toBlockId: string,
  fromDate: Date,
) => {
  return prisma.calendarBlockException.updateMany({
    where: { blockId: fromBlockId, occurrenceDate: { gte: fromDate } },
    data: { blockId: toBlockId },
  })
}
