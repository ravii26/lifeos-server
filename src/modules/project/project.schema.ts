import { z } from "zod"

const projectStatus = z.enum(["ACTIVE", "COMPLETED", "PAUSED", "ABANDONED"])

export const createProjectSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  areaId: z.string().min(1, "areaId is required"),
  goalId: z.string().optional(),
  status: projectStatus.optional(),
  deadline: z.coerce.date().optional(),
})

export const updateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  areaId: z.string().min(1).optional(),
  goalId: z.string().nullable().optional(),
  status: projectStatus.optional(),
  deadline: z.coerce.date().nullable().optional(),
})

export const listProjectsSchema = z.object({
  areaId: z.string().optional(),
  goalId: z.string().optional(),
  status: projectStatus.optional(),
})

export type CreateProjectDto = z.infer<typeof createProjectSchema>
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>
export type ListProjectsDto = z.infer<typeof listProjectsSchema>
