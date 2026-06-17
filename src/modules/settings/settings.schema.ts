import { z } from "zod"

export const updateSettingsSchema = z.object({
  vibe:     z.enum(["calm", "focused", "energetic"]).optional(),
  accent:   z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex colour").optional(),
  font:     z.enum(["inter", "mono", "serif"]).optional(),
  startTab: z.enum(["today", "areas", "dump"]).optional(),
})

export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>
