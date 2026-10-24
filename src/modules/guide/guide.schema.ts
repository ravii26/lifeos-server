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
  // A link, a few words, or a whole pasted chapter (read whole up to 30,000 characters, then in parts).
  text: z.string().max(100_000).optional(),
})

export const decideSaveSchema = z.object({
  // ACTION = Do it, SHELF = Lift me up, LATER = Watch later, LIST = Add to a list, DROP = let it go.
  choice: z.enum(["ACTION", "SHELF", "DROP", "LATER", "LIST"]),
  // LATER: how long it is, if known. LIST: the list to put it on.
  minutes: z.number().int().min(1).max(600).optional(),
  list: z.string().max(60).optional(),
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
// 1 to 3 short names for when this save should come back; the server cleans them.
export const saveMoodsSchema = z.object({ moods: z.array(z.string().max(60)).min(1).max(5) })

export type DecideSaveDto = z.infer<typeof decideSaveSchema>
export type RespondDto = z.infer<typeof respondSchema>
export type HistoryQueryDto = z.infer<typeof historySchema>

// Up to 10 shared items at once (each a link, possibly with a few words).
export const batchSavesSchema = z.object({ items: z.array(z.string().min(1).max(4000)).min(1).max(10) })
export const decideManySchema = z.object({ ids: z.array(z.string()).min(1).max(30), choice: z.enum(["LATER", "DROP"]) })
