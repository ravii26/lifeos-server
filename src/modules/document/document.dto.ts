// Response DTOs for the Library (document ingestion + Q&A) module.

export interface DocumentDto {
  id: string
  title: string
  sourceType: "PASTED" | "UPLOADED"
  status: "PENDING" | "READY" | "FAILED"
  chunkCount: number
  topicId: string | null
  notebookId: string | null
  error: string | null
  createdAt: Date
}

// A flattened AI-extracted action proposed from a document (phase 2).
export interface SuggestionDto {
  id: string
  documentId: string
  itemType: "HABIT" | "GOAL" | "TASK"
  title: string
  detail: string | null
  confidence: number
  status: "PENDING" | "ACCEPTED" | "DISMISSED"
  sourceHeading: string | null
  suggestedAreaId: string | null
  suggestedAreaName: string | null
  frequency: string | null
  targetMinutes: number | null
  priority: string | null
  dueDate: string | null
  // Set once accepted — points at the created Task/Habit/Goal.
  createdEntity: { type: string; id: string } | null
}
