import { z } from "zod"

const masteryLevel = z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"])

export const createTopicSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  areaId: z.string().min(1, "areaId is required"),
  masteryLevel: masteryLevel.optional(),
})

export const updateTopicSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  areaId: z.string().min(1).optional(),
  masteryLevel: masteryLevel.optional(),
})

export const listTopicsSchema = z.object({
  areaId: z.string().optional(),
  masteryLevel: masteryLevel.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export type CreateTopicDto = z.infer<typeof createTopicSchema>
export type UpdateTopicDto = z.infer<typeof updateTopicSchema>
export type ListTopicsDto = z.infer<typeof listTopicsSchema>
