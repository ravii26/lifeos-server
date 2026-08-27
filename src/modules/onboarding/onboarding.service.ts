import { findAreasByUser } from "../area/area.repository.js"
import { getUserNow } from "../../lib/rag.js"
import { extractOnboardingSetup, type OnboardingExtraction } from "./onboarding.extract.js"

// Stateless by design — unlike Document's extract→suggestion→accept flow,
// there's no async ingest step and nothing sensitive worth persisting
// server-side before the user has reviewed it. The client creates the real
// Area/Goal/Habit/Task rows itself, via the normal create endpoints, once
// the user picks which proposed items to keep.
export const extractOnboardingService = async (
  userId: string,
  text: string,
): Promise<OnboardingExtraction> => {
  const [existingAreas, now] = await Promise.all([findAreasByUser(userId), getUserNow(userId)])
  return extractOnboardingSetup(
    text,
    existingAreas.map((a) => a.name),
    now,
  )
}
