import { z } from "zod"

// Create a document from pasted text, OR via multipart upload (a .txt/.md file
// in the "file" field). `text` is optional here because the uploaded file
// supplies the body instead — the controller enforces "text OR file". `title`
// is optional; the service derives one from the first heading/line when absent.
// The 500k cap sits well under the 1mb JSON body limit in app.ts.
export const createDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(500_000).optional(),
  topicId: z.string().optional(),
  notebookId: z.string().optional(),
})

export const listDocumentsSchema = z.object({
  status: z.enum(["PENDING", "READY", "FAILED"]).optional(),
})

// Ask a question answered from the user's ingested material. Scope to one
// document with `documentId`, or omit to search the whole library.
export const askSchema = z.object({
  question: z.string().min(1).max(1000),
  documentId: z.string().optional(),
})

// Accept an AI-extracted suggestion, turning it into a real Task/Habit/Goal.
// The user can override the AI's area/priority pick at accept time. HABIT/GOAL
// require an area (from here or the suggestion); the service enforces that.
export const acceptSuggestionSchema = z.object({
  areaId: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
})

export type CreateDocumentDto = z.infer<typeof createDocumentSchema>
export type ListDocumentsDto = z.infer<typeof listDocumentsSchema>
export type AskDto = z.infer<typeof askSchema>
export type AcceptSuggestionDto = z.infer<typeof acceptSuggestionSchema>
