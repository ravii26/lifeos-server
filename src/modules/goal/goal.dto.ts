// Response DTO — the shape the server returns for a Goal.
export interface GoalDto {
  id: string
  areaId: string
  title: string
  description: string | null
  priority: string
  status: string
  deadline: Date | null
  createdAt: Date
  updatedAt: Date
}
