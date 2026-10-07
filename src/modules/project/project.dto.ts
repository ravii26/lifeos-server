// Response DTO — the shape the server returns for a Project.
export interface ProjectDto {
  id: string
  areaId: string
  goalId: string | null
  title: string
  description: string | null
  status: string
  deadline: Date | null
  kind: string
  why: string | null
  priority: string
  createdAt: Date
  updatedAt: Date
}
