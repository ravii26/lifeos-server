import { z } from "zod"

// Optional (user-toggleable) modules. Core modules (areas/tasks/capture) are
// always on and are never stored, so they're not accepted here.
export const OPTIONAL_MODULES = [
  "habits", "goals", "projects", "calendar", "knowledge", "vault",
  "focus", "review", "learn", "identity", "behaviour", "graph", "decisions",
  "library",
] as const

export const updateSettingsSchema = z.object({
  vibe:     z.enum(["calm", "focused", "energetic"]).optional(),
  accent:   z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex colour").optional(),
  font:     z.enum(["inter", "mono", "serif"]).optional(),
  startTab: z.enum(["today", "areas", "dump"]).optional(),
  enabledModules: z.array(z.enum(OPTIONAL_MODULES)).optional(),
})

export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>
