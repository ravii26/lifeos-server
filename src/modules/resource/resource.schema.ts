import { z } from "zod"

const resourceType = z.enum([
  "BOOK", "COURSE", "VIDEO", "ARTICLE", "PODCAST", "DOCUMENTATION", "OTHER",
])
const resourceStatus = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"])

export const createResourceSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  topicId: z.string().min(1, "topicId is required"),
  resourceType: resourceType,
  url: z.string().url().nullable().optional(),
  platform: z.string().max(100).nullable().optional(),
  status: resourceStatus.optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export const updateResourceSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  resourceType: resourceType.optional(),
  url: z.string().url().nullable().optional(),
  platform: z.string().max(100).nullable().optional(),
  status: resourceStatus.optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export const updateProgressSchema = z.object({
  lessonsCompleted: z.number().int().min(0).optional(),
  totalLessons: z.number().int().min(1).nullable().optional(),
  minutesConsumed: z.number().int().min(0).optional(),
  // convenience: auto-mark COMPLETED when lessonsCompleted === totalLessons
  autoComplete: z.boolean().optional(),
})

export type UpdateProgressDto = z.infer<typeof updateProgressSchema>

export const listResourcesSchema = z.object({
  topicId: z.string().optional(),
  resourceType: resourceType.optional(),
  status: resourceStatus.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export type CreateResourceDto = z.infer<typeof createResourceSchema>
export type UpdateResourceDto = z.infer<typeof updateResourceSchema>
export type ListResourcesDto = z.infer<typeof listResourcesSchema>
