import { z } from "zod"

export const behaviorEvent = z.enum([
  "APP_OPEN",
  "TASK_COMPLETED",
  "TASK_DEFERRED",
  "HABIT_LOGGED",
  "CAPTURE_CREATED",
  "VAULT_ACCESSED",
  "FOCUS_STARTED",
  "FOCUS_COMPLETED",
  "FOCUS_ABANDONED",
  "AREA_VIEWED",
  "REVIEW_OPENED",
  "DOCUMENT_INGESTED",
  "QUESTION_ASKED",
  "SUGGESTIONS_EXTRACTED",
])

// Client-reported events (e.g. APP_OPEN, AREA_VIEWED). Server-side events
// are fired internally by services, not through this endpoint.
export const logBehaviorSchema = z.object({
  eventType: behaviorEvent,
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const listBehaviorSchema = z.object({
  eventType: behaviorEvent.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export type LogBehaviorDto = z.infer<typeof logBehaviorSchema>
export type ListBehaviorDto = z.infer<typeof listBehaviorSchema>
