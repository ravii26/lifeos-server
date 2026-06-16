import { z } from "zod"

export const createNotebookSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  topicId: z.string().min(1, "topicId is required"),
  tags: z.array(z.string().max(50)).optional(),
})

export const updateNotebookSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().max(50)).optional(),
})

export const listNotebooksSchema = z.object({
  topicId: z.string().optional(),
})

export type CreateNotebookDto = z.infer<typeof createNotebookSchema>
export type UpdateNotebookDto = z.infer<typeof updateNotebookSchema>
export type ListNotebooksDto = z.infer<typeof listNotebooksSchema>
