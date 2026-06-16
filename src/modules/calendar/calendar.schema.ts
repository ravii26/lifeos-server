import { z } from "zod"

export const createBlockSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    blockType: z.string().max(50).optional(),
    isActual: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
    taskId: z.string().optional(),
    habitId: z.string().optional(),
    areaId: z.string().optional(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"],
  })

export const updateBlockSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  blockType: z.string().max(50).optional(),
  isActual: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  taskId: z.string().nullable().optional(),
  habitId: z.string().nullable().optional(),
  areaId: z.string().nullable().optional(),
})

export const listBlocksSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  areaId: z.string().optional(),
  taskId: z.string().optional(),
  habitId: z.string().optional(),
})

export type CreateBlockDto = z.infer<typeof createBlockSchema>
export type UpdateBlockDto = z.infer<typeof updateBlockSchema>
export type ListBlocksDto = z.infer<typeof listBlocksSchema>
