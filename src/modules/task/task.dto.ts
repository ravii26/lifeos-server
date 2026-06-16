// Response DTO — the shape the server returns for a Task.
export interface TaskDto {
  id: string
  areaId: string | null
  goalId: string | null
  projectId: string | null
  title: string
  description: string | null
  status: string
  priority: string
  taskType: string
  targetCount: number | null
  completedCount: number
  targetMinutes: number | null
  dueDate: Date | null
  isRecurring: boolean
  recurrence: string | null
  source: string
  sourceId: string | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
