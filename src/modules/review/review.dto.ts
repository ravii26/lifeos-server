// Response DTOs for Review and its linked insight-reviews.
export interface ReviewDto {
  id: string
  reviewType: string
  periodStart: Date
  periodEnd: Date
  summary: string | null
  highlights: string | null
  improvements: string | null
  userNote: string | null
  aiInsights: unknown
  createdAt: Date
}

// An auto-generated review draft: factual period stats, pre-filled editable
// text, and the AI narrative — the user edits then saves via POST /reviews.
export interface ReviewDraftDto {
  reviewType: string
  periodStart: Date
  periodEnd: Date
  stats: {
    tasksCompleted: number
    habitsLogged: number
    focusMinutes: number
    topStreaks: { title: string; streak: number }[]
    areaScores: { name: string; score: number }[]
    activeGoals: { title: string; confidence: number; label: string }[]
  }
  suggestedSummary: string
  suggestedHighlights: string
  suggestedImprovements: string
  aiInsights: { narrative: string; observations: string[]; source: string }
}

export interface InsightReviewDto {
  id: string
  reviewId: string
  noteId: string
  status: string
  userNote: string | null
  createdAt: Date
  updatedAt: Date
}
