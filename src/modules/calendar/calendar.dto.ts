// Response DTO — the shape the server returns for a CalendarBlock.
export interface CalendarBlockDto {
  id: string
  taskId: string | null
  habitId: string | null
  areaId: string | null
  title: string
  startTime: Date
  endTime: Date
  blockType: string
  isActual: boolean
  notes: string | null
  createdAt: Date
  updatedAt: Date
}
