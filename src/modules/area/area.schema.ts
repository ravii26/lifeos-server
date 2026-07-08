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

export const listAreasSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export const listAreaSnapshotsSchema = z.object({
  limit: z.coerce.number().int().positive().max(365).optional(),
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
export type ListAreasDto = z.infer<typeof listAreasSchema>
export type ListAreaSnapshotsDto = z.infer<typeof listAreaSnapshotsSchema>
