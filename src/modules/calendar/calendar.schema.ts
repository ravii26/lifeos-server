import { z } from "zod"

export const createBlockSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    blockType: z.string().max(50).optional(),
    isActual: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
    taskId: z.string().optional(),
    habitId: z.string().optional(),
    areaId: z.string().optional(),
    // iCal RRULE string, e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR". Omit for a one-off block.
    recurrenceRule: z.string().max(500).optional(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"],
  })

export const updateBlockSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  blockType: z.string().max(50).optional(),
  isActual: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  taskId: z.string().nullable().optional(),
  habitId: z.string().nullable().optional(),
  areaId: z.string().nullable().optional(),
  // Pass null to turn a recurring block back into a one-off.
  recurrenceRule: z.string().max(500).nullable().optional(),
})

export const listBlocksSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  areaId: z.string().optional(),
  taskId: z.string().optional(),
  habitId: z.string().optional(),
})

// Create or update a single per-occurrence override on a recurring block.
// occurrenceDate must match the original start instant of the occurrence.
export const upsertExceptionSchema = z
  .object({
    occurrenceDate: z.coerce.date(),
    isCancelled: z.boolean().optional(),
    title: z.string().min(1).max(200).nullable().optional(),
    startTime: z.coerce.date().nullable().optional(),
    endTime: z.coerce.date().nullable().optional(),
    blockType: z.string().max(50).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (data) => !(data.startTime && data.endTime) || data.endTime > data.startTime,
    { message: "endTime must be after startTime", path: ["endTime"] },
  )

// Split a recurring series at fromOccurrenceDate ("this and following"): occurrences
// before it stay on the original block; this one onward become a new block carrying
// the provided overrides. Omitted fields inherit from the original series.
export const splitSeriesSchema = z
  .object({
    fromOccurrenceDate: z.coerce.date(),
    title: z.string().min(1).max(200).optional(),
    startTime: z.coerce.date().optional(),
    endTime: z.coerce.date().optional(),
    blockType: z.string().max(50).optional(),
    notes: z.string().max(2000).nullable().optional(),
    taskId: z.string().nullable().optional(),
    habitId: z.string().nullable().optional(),
    areaId: z.string().nullable().optional(),
    recurrenceRule: z.string().max(500).optional(),
  })
  .refine(
    (data) => !(data.startTime && data.endTime) || data.endTime > data.startTime,
    { message: "endTime must be after startTime", path: ["endTime"] },
  )

export type CreateBlockDto = z.infer<typeof createBlockSchema>
export type UpdateBlockDto = z.infer<typeof updateBlockSchema>
export type ListBlocksDto = z.infer<typeof listBlocksSchema>
export type UpsertExceptionDto = z.infer<typeof upsertExceptionSchema>
export type SplitSeriesDto = z.infer<typeof splitSeriesSchema>
