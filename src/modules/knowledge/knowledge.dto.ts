// Response DTOs for cross-source Q&A (Documents + Notes + Resources).

// One passage the answer was drawn from, surfaced to the UI so the user can see
// where the answer came from (and that it's grounded in their own material).
export interface AskSourceDto {
  sourceType: "DOCUMENT" | "NOTE" | "RESOURCE"
  sourceId: string
  sourceTitle: string
  heading: string | null
  snippet: string
  score: number
}

export interface AskResultDto {
  answer: string
  sources: AskSourceDto[]
  // false when no AI provider was available and we returned the best-matching
  // passage verbatim instead of a synthesised answer.
  usedAi: boolean
}
