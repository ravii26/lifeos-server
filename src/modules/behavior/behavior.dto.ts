// Response DTO — the shape the server returns for a BehaviorLog event.
export interface BehaviorLogDto {
  id: string
  eventType: string
  metadata: unknown
  occurredAt: Date
}
