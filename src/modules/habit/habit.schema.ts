import { z } from "zod"

const habitType = z.enum(["BOOLEAN", "COUNT", "TIMER"])
const frequency = z.enum(["DAILY", "WEEKLY", "CUSTOM"])
const day = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])

export const createHabitSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  areaId: z.string().min(1, "areaId is required"),
  habitType: habitType.optional(),
  targetCount: z.number().int().positive().optional(),
  targetMinutes: z.number().int().positive().optional(),
  frequency: frequency.optional(),
  weeklyTarget: z.number().int().positive().max(7).optional(),
  specificDays: z.array(day).optional(),
  reminderTime: z.string().regex(/^\d{2}:\d{2}$/, "reminderTime must be HH:MM").optional(),
  isActive: z.boolean().optional(),
})

export const updateHabitSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  areaId: z.string().min(1).optional(),
  habitType: habitType.optional(),
  targetCount: z.number().int().positive().nullable().optional(),
  targetMinutes: z.number().int().positive().nullable().optional(),
  frequency: frequency.optional(),
  weeklyTarget: z.number().int().positive().max(7).nullable().optional(),
  specificDays: z.array(day).optional(),
  reminderTime: z.string().regex(/^\d{2}:\d{2}$/, "reminderTime must be HH:MM").nullable().optional(),
  isActive: z.boolean().optional(),
})

export const listHabitsSchema = z.object({
  areaId: z.string().optional(),
  isActive: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export const logHabitSchema = z.object({
  date: z.coerce.date().optional(),
  completed: z.boolean().optional(),
  count: z.number().int().nonnegative().optional(),
  minutes: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
})

export const listLogsSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export type CreateHabitDto = z.infer<typeof createHabitSchema>
export type UpdateHabitDto = z.infer<typeof updateHabitSchema>
export type ListHabitsDto = z.infer<typeof listHabitsSchema>
export type LogHabitDto = z.infer<typeof logHabitSchema>
export type ListLogsDto = z.infer<typeof listLogsSchema>
