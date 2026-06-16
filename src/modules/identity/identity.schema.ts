import { z } from "zod"

// Identity is one record per user. Everything is optional — the user
// fills it in gradually over time. PUT upserts the whole thing.
export const upsertIdentitySchema = z.object({
  personality: z.string().max(2000).nullable().optional(),
  values: z.array(z.string().max(100)).optional(),
  strengths: z.array(z.string().max(100)).optional(),
  weaknesses: z.array(z.string().max(100)).optional(),
  purpose: z.string().max(2000).nullable().optional(),
  thisYearGoal: z.string().max(2000).nullable().optional(),
  bigPicture: z.string().max(2000).nullable().optional(),
  lifeVision: z.string().max(2000).nullable().optional(),
})

export type UpsertIdentityDto = z.infer<typeof upsertIdentitySchema>
