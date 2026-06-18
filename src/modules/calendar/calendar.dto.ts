// Response DTO — the shape the server returns for a CalendarBlock.
// Also used for virtually-expanded recurring occurrences (see the recurring* fields).
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
  // Recurrence
  recurrenceRule: string | null
  isRecurring: boolean
  // Set only on virtual occurrences expanded from a recurring template.
  // recurringBlockId = the template's id; occurrenceDate = the original
  // (pre-override) start instant, used as the key when editing one occurrence.
  recurringBlockId: string | null
  occurrenceDate: Date | null
  createdAt: Date
  updatedAt: Date
}

// Response DTO for a single per-occurrence override row.
export interface CalendarBlockExceptionDto {
  id: string
  blockId: string
  occurrenceDate: Date
  isCancelled: boolean
  title: string | null
  startTime: Date | null
  endTime: Date | null
  blockType: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}
