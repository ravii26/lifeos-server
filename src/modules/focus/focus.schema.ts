import { z } from "zod"

export const startFocusSchema = z.object({
  startedAt: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
  taskId: z.string().optional(),
  habitId: z.string().optional(),
  calendarBlockId: z.string().optional(),
})

export const updateFocusSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  taskId: z.string().nullable().optional(),
  habitId: z.string().nullable().optional(),
  calendarBlockId: z.string().nullable().optional(),
})

export const listFocusSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  taskId: z.string().optional(),
  habitId: z.string().optional(),
})

export type StartFocusDto = z.infer<typeof startFocusSchema>
export type UpdateFocusDto = z.infer<typeof updateFocusSchema>
export type ListFocusDto = z.infer<typeof listFocusSchema>
