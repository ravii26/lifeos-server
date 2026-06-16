// Response DTO — the shape the server returns for a FocusSession.
export interface FocusSessionDto {
  id: string
  taskId: string | null
  habitId: string | null
  calendarBlockId: string | null
  startedAt: Date
  endedAt: Date | null
  durationMinutes: number | null
  notes: string | null
  createdAt: Date
}
