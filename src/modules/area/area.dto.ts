// Response DTO — the shape the server returns for an Area.
export interface AreaDto {
  id: string
  name: string
  type: string
  color: string
  icon: string
  order: number
  isDefault: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

// Area enriched with read-only computed scoring fields (A2). Returned by
// GET /areas so the dashboard donuts can render without the client
// re-implementing the score formula.
export interface AreaWithScoreDto extends AreaDto {
  score: number // 0..100 blend of tasks + habits + learning
  tasksDone: number
  tasksTotal: number
  streak: number // best current habit streak in the area
  focusMins: number // minutes logged against this area's habits today
}
