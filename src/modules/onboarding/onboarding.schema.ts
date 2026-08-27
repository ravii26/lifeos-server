import { z } from "zod"

export const extractOnboardingSchema = z.object({
  text: z.string().trim().min(10, "Tell us a bit more — a sentence or two is plenty").max(4000),
})

export type ExtractOnboardingDto = z.infer<typeof extractOnboardingSchema>
