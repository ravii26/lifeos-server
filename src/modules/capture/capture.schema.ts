import { z } from "zod"

// The outcome types a capture can be converted into. Matches CaptureType
// in capture.ai.ts.
export const captureType = z.enum(["TASK", "HABIT", "NOTE", "RESOURCE", "VAULT"])

export const createCaptureSchema = z.object({
  text: z.string().min(1, "Text is required").max(2000),
})

// Override the AI's guessed type before converting.
export const updateCaptureSchema = z.object({
  type: captureType,
})

// Convert a capture into a real entity. Some targets need a parent link
// the raw text can't supply (a Habit needs an areaId; a Note/Resource
// needs a topicId) — the client passes them here.
export const convertCaptureSchema = z.object({
  areaId: z.string().optional(),
  topicId: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
})

export const listCapturesSchema = z.object({
  processed: z.enum(["true", "false"]).optional(),
})

export type CreateCaptureDto = z.infer<typeof createCaptureSchema>
export type UpdateCaptureDto = z.infer<typeof updateCaptureSchema>
export type ConvertCaptureDto = z.infer<typeof convertCaptureSchema>
export type ListCapturesDto = z.infer<typeof listCapturesSchema>
