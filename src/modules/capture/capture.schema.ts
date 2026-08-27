import { z } from "zod"

// The outcome types a capture can be converted into. Matches CaptureType
// in capture.ai.ts.
export const captureType = z.enum(["TASK", "HABIT", "NOTE", "RESOURCE", "VAULT"])

// Text is optional because a capture can be media-only (image/audio). The
// controller enforces "text OR file" since the uploaded file isn't visible to
// this body schema. For multipart requests `text` arrives as a caption string.
export const createCaptureSchema = z.object({
  text: z.string().min(1, "Text is required").max(2000).optional(),
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
  // The "learn-and-forget loop": when converting a NOTE/RESOURCE, optionally
  // create one concrete follow-up Task in the same beat and link it (ADVANCES)
  // back to the note/resource, so the learning isn't just filed away — always
  // opt-in from the client, never automatic.
  createFollowUpTask: z.boolean().optional(),
  followUpTaskTitle: z.string().min(1).max(200).optional(),
})

export const listCapturesSchema = z.object({
  processed: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

export type CreateCaptureDto = z.infer<typeof createCaptureSchema>
export type UpdateCaptureDto = z.infer<typeof updateCaptureSchema>
export type ConvertCaptureDto = z.infer<typeof convertCaptureSchema>
export type ListCapturesDto = z.infer<typeof listCapturesSchema>
