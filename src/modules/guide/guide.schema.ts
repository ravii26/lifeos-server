import { z } from "zod"

export const respondSchema = z.object({
  status: z.enum(["DONE", "MINIMUM", "SKIPPED"]),
  reason: z.string().max(300).optional(),
  // The night being answered (YYYY-MM-DD). Defaults to tonight, or last night
  // when answering after midnight.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(["APP", "NOTIFICATION"]).optional(),
})

export const historySchema = z.object({
  days: z.coerce.number().int().positive().max(90).optional(),
})

export const createSaveSchema = z.object({
  text: z.string().max(4000).optional(),
})

export const decideSaveSchema = z.object({
  choice: z.enum(["ACTION", "SHELF", "DROP"]),
  action: z.string().max(200).optional(),
  minimum: z.string().max(200).optional(),
  areaId: z.string().optional(),
  when: z.enum(["TONIGHT", "THIS_WEEK", "LATER"]).optional(),
  // One to three steps to make (each a to-do or a habit). `action` alone still works.
  actions: z
    .array(
      z.object({
        action: z.string().min(1).max(200),
        minimum: z.string().max(200).optional(),
        as: z.enum(["TODO", "HABIT"]).optional(),
        when: z.enum(["TONIGHT", "THIS_WEEK", "LATER"]).optional(),
        areaId: z.string().optional(),
      }),
    )
    .max(3)
    .optional(),
})

export const savePurposeSchema = z.object({ purpose: z.enum(["LEARN", "FEELING"]) })

export type DecideSaveDto = z.infer<typeof decideSaveSchema>
export type RespondDto = z.infer<typeof respondSchema>
export type HistoryQueryDto = z.infer<typeof historySchema>
