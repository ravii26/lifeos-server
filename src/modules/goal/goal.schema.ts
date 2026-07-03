import { z } from "zod"

const priority = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
const goalStatus = z.enum(["ACTIVE", "PARKED", "COMPLETED", "PAUSED", "ABANDONED"])

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
  // When "true", each goal is returned with its live confidence number.
  withConfidence: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

// Activating a goal when the active slots are full requires telling the server
// which goal to park in its place. When there's a free slot, parkGoalId is
// omitted and activation just happens.
export const activateGoalSchema = z.object({
  parkGoalId: z.string().min(1).optional(),
})

export type CreateGoalDto = z.infer<typeof createGoalSchema>
export type UpdateGoalDto = z.infer<typeof updateGoalSchema>
export type ListGoalsDto = z.infer<typeof listGoalsSchema>
export type ActivateGoalDto = z.infer<typeof activateGoalSchema>
