import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createBlock = (data: Prisma.CalendarBlockUncheckedCreateInput) => {
  return prisma.calendarBlock.create({ data })
}

export const findBlocksByUser = (
  userId: string,
  filters: Prisma.CalendarBlockWhereInput = {},
) => {
  return prisma.calendarBlock.findMany({
    where: { userId, ...filters },
    orderBy: { startTime: "asc" },
  })
}

export const findBlockById = (id: string, userId: string) => {
  return prisma.calendarBlock.findFirst({ where: { id, userId } })
}

export const updateBlock = (id: string, data: Prisma.CalendarBlockUpdateInput) => {
  return prisma.calendarBlock.update({ where: { id }, data })
}

export const deleteBlock = (id: string) => {
  return prisma.calendarBlock.delete({ where: { id } })
}
