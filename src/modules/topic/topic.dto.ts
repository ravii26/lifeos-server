// Response DTO — the shape the server returns for a Topic.
export interface TopicDto {
  id: string
  areaId: string
  title: string
  description: string | null
  masteryLevel: string
  createdAt: Date
  updatedAt: Date
}
