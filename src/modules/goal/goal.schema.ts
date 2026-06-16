import { z } from "zod"

const priority = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
const goalStatus = z.enum(["ACTIVE", "COMPLETED", "PAUSED", "ABANDONED"])

export const createGoalSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  areaId: z.string().min(1, "areaId is required"),
  priority: priority.optional(),
  status: goalStatus.optional(),
  deadline: z.coerce.date().optional(),
})

export const updateGoalSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  areaId: z.string().min(1).optional(),
  priority: priority.optional(),
  status: goalStatus.optional(),
  deadline: z.coerce.date().nullable().optional(),
})

export const listGoalsSchema = z.object({
  areaId: z.string().optional(),
  status: goalStatus.optional(),
  priority: priority.optional(),
})

export type CreateGoalDto = z.infer<typeof createGoalSchema>
export type UpdateGoalDto = z.infer<typeof updateGoalSchema>
export type ListGoalsDto = z.infer<typeof listGoalsSchema>
