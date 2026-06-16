import { z } from "zod"

export const createAreaSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  type: z.enum(["PRIMARY", "MAINTENANCE"]).optional(),
  color: z.string().min(1, "Color is required"),
  icon: z.string().min(1, "Icon is required"),
  order: z.number().int().nonnegative().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const updateAreaSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["PRIMARY", "MAINTENANCE"]).optional(),
  color: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
  order: z.number().int().nonnegative().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export type CreateAreaDto = z.infer<typeof createAreaSchema>
export type UpdateAreaDto = z.infer<typeof updateAreaSchema>
