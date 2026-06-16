import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

export const createHabit = (data: Prisma.HabitUncheckedCreateInput) => {
  return prisma.habit.create({ data })
}

export const findHabitsByUser = (userId: string, filters: Prisma.HabitWhereInput = {}) => {
  return prisma.habit.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
  })
}

export const findHabitById = (id: string, userId: string) => {
  return prisma.habit.findFirst({ where: { id, userId } })
}

export const updateHabit = (id: string, data: Prisma.HabitUpdateInput) => {
  return prisma.habit.update({ where: { id }, data })
}

export const deleteHabit = (id: string) => {
  return prisma.habit.delete({ where: { id } })
}

// Idempotent per-day log: same habit + date updates the existing row.
export const upsertHabitLog = (
  habitId: string,
  userId: string,
  date: Date,
  data: { completed?: boolean; count?: number; minutes?: number; notes?: string | null },
) => {
  return prisma.habitLog.upsert({
    where: { habitId_date: { habitId, date } },
    create: { habitId, userId, date, ...data },
    update: data,
  })
}

export const findHabitLogs = (
  habitId: string,
  range: { gte?: Date; lte?: Date } = {},
) => {
  const dateFilter = Object.keys(range).length ? { date: range } : {}
  return prisma.habitLog.findMany({
    where: { habitId, ...dateFilter },
    orderBy: { date: "desc" },
  })
}
