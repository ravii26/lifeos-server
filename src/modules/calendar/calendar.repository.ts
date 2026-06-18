import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createBlock = (data: Prisma.CalendarBlockUncheckedCreateInput) => {
  return prisma.calendarBlock.create({ data })
}

// Includes exceptions so the service can expand recurring templates in one pass.
export const findBlocksByUser = (
  userId: string,
  filters: Prisma.CalendarBlockWhereInput = {},
) => {
  return prisma.calendarBlock.findMany({
    where: { userId, ...filters },
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

export const updateBlock = (id: string, data: Prisma.CalendarBlockUpdateInput) => {
  return prisma.calendarBlock.update({ where: { id }, data })
}

export const deleteBlock = (id: string) => {
  return prisma.calendarBlock.delete({ where: { id } })
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
