import { z } from "zod"

const taskStatus = z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
const priority = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
const taskType = z.enum(["BOOLEAN", "COUNT", "TIMER"])
const recurrence = z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"])
const taskSource = z.enum(["MANUAL", "DUMP", "LEARN"])

export const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  areaId: z.string().optional(),
  goalId: z.string().optional(),
  projectId: z.string().optional(),
  status: taskStatus.optional(),
  priority: priority.optional(),
  taskType: taskType.optional(),
  targetCount: z.number().int().positive().optional(),
  targetMinutes: z.number().int().positive().optional(),
  dueDate: z.coerce.date().optional(),
  isRecurring: z.boolean().optional(),
  recurrence: recurrence.optional(),
  // Provenance — lets the client create a task "↳ from Learn" (a Note) or
  // "↳ from Dump" (a Capture) and keep a back-reference (B6).
  source: taskSource.optional(),
  sourceId: z.string().optional(),
})

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  areaId: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  status: taskStatus.optional(),
  priority: priority.optional(),
  taskType: taskType.optional(),
  targetCount: z.number().int().positive().nullable().optional(),
  targetMinutes: z.number().int().positive().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  isRecurring: z.boolean().optional(),
  recurrence: recurrence.nullable().optional(),
})

export const listTasksSchema = z.object({
  status: taskStatus.optional(),
  priority: priority.optional(),
  areaId: z.string().optional(),
  goalId: z.string().optional(),
  projectId: z.string().optional(),
})

export type CreateTaskDto = z.infer<typeof createTaskSchema>
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>
export type ListTasksDto = z.infer<typeof listTasksSchema>
