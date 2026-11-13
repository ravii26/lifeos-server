import { z } from "zod"

const tier = z.enum(["MAIN", "SECONDARY", "MAINTAIN", "LATER"])
const id = z.string().min(1).max(64)

export const startSeasonSchema = z.object({
  name: z.string().max(60).nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  endEvent: z.string().max(120).nullable().optional(),
  focusIds: z.array(id).max(2),
  keepGoingIds: z.array(id).max(3).default([]),
  parked: z.array(z.object({ areaId: id, until: z.coerce.date().nullable().optional() })).max(30).default([]),
})

export const moveAreaSchema = z.object({
  tier,
  laterUntil: z.coerce.date().nullable().optional(),
  swapOutId: id.optional(),
  swapOutTier: tier.optional(),
  swapOutUntil: z.coerce.date().nullable().optional(),
})

export type StartSeasonDto = z.infer<typeof startSeasonSchema>
export type MoveAreaDto = z.infer<typeof moveAreaSchema>
