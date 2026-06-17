// Response DTO — a friendly, flattened shape for a Capture.
// The DB stores classification inside JSON columns; the service flattens
// it into these fields so the client gets the same shape the design used:
// { text, type, confidence, processed, meta }.
import type { CaptureType } from "./capture.ai.js"

export interface CaptureDto {
  id: string
  text: string
  type: CaptureType
  confidence: number | null
  processed: boolean
  status: string // PENDING | CONVERTED | DISMISSED
  meta: Record<string, unknown>
  detectedUrl: string | null
  // Set after conversion — { type, id } pointing at the created entity.
  createdOutput: { type: CaptureType; id: string } | null
  createdAt: Date
}
