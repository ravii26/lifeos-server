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

export interface InsightReviewDto {
  id: string
  reviewId: string
  noteId: string
  status: string
  userNote: string | null
  createdAt: Date
  updatedAt: Date
}
