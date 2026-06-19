import type { GoalConfidence } from "./goal.confidence.js"

// Response DTO — the shape the server returns for a Goal.
export interface GoalDto {
  id: string
  areaId: string
  title: string
  description: string | null
  priority: string
  status: string
  deadline: Date | null
  activatedAt: Date | null
  parkedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// Goal enriched with its live confidence number. Returned by GET /goals and
// GET /goals/:id/confidence. `confidence` is null only if scoring was skipped.
export interface GoalWithConfidenceDto extends GoalDto {
  confidence: GoalConfidence | null
}

// Returned by the activate/park endpoints so the frontend can refresh the
// focus board in one round-trip: the goal that changed + the current active set.
export interface FocusStateDto {
  goal: GoalDto
  activeGoals: GoalDto[]
  maxActive: number
  slotsRemaining: number
}

// The whole focus screen in one payload: active goals + parked backlog (both
// with live confidence) + free slot count.
export interface GoalBoardDto {
  active: GoalWithConfidenceDto[]
  parked: GoalWithConfidenceDto[]
  maxActive: number
  slotsRemaining: number
}
