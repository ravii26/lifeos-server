import { z } from "zod"

const noteType = z.enum(["CONCEPT", "INSIGHT", "SUMMARY", "QUOTE", "OTHER"])

export const createNoteSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Content is required"),
  topicId: z.string().min(1, "topicId is required"),
  notebookId: z.string().optional(),
  resourceId: z.string().optional(),
  noteType: noteType.optional(),
  tags: z.array(z.string().max(50)).optional(),
})

export const updateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  notebookId: z.string().nullable().optional(),
  resourceId: z.string().nullable().optional(),
  noteType: noteType.optional(),
  tags: z.array(z.string().max(50)).optional(),
})

export const listNotesSchema = z.object({
  topicId: z.string().optional(),
  notebookId: z.string().optional(),
  resourceId: z.string().optional(),
  noteType: noteType.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export type CreateNoteDto = z.infer<typeof createNoteSchema>
export type UpdateNoteDto = z.infer<typeof updateNoteSchema>
export type ListNotesDto = z.infer<typeof listNotesSchema>
