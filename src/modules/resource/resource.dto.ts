// Response DTO — the shape the server returns for a Resource.
export interface ResourceDto {
  id: string
  topicId: string
  title: string
  resourceType: string
  url: string | null
  platform: string | null
  status: string
  rating: number | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}
