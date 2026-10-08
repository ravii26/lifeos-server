import { env } from "../config/env.config.js"
import { aiCreditsAllowed, compatProvider } from "./aicredits.js"
import logger from "./logger.js"

// Shared "try providers in order → deterministic heuristic" orchestration used
// by every AI-backed feature. Availability is decided at the call site: pass
// `undefined` for a provider that isn't usable so this stays a generic loop.
//
// AICredits speaks the same chat format as Groq, so it does not need its own
// function at each call site: the `groq` function is run once more with the
// AICredits context (see lib/groq.ts). Gemini keeps its own function.
interface AiFallbackProviders<T> {
  gemini?: () => Promise<T>
  groq?: () => Promise<T>
}

export type AiProviderName = "aicredits" | "gemini" | "groq"

const SEQUENCE: AiProviderName[] = ["aicredits", "gemini", "groq"]

// Preferred first, then the others in the fixed order, keeping only what is
// available. With nothing preferred: AICredits first when it is configured
// (the credits you paid for), otherwise Groq (the long-standing default).
export const providerOrder = (
  preferred: AiProviderName | undefined,
  have: Record<AiProviderName, boolean>,
): AiProviderName[] => {
  const first: AiProviderName = preferred ?? (have.aicredits ? "aicredits" : "groq")
  return [first, ...SEQUENCE.filter((p) => p !== first)].filter((p) => have[p])
}

const LABEL: Record<AiProviderName, string> = { aicredits: "AICredits", gemini: "Gemini", groq: "Groq" }

export async function runWithAiFallback<T>(
  label: string,
  providers: AiFallbackProviders<T>,
  heuristic: () => T | Promise<T>,
): Promise<T> {
  const order = providerOrder(env.PREFERRED_AI_PROVIDER, {
    aicredits: !!providers.groq && aiCreditsAllowed(),
    gemini: !!providers.gemini,
    groq: !!providers.groq && !!env.GROQ_API_KEY,
  })

  for (const name of order) {
    try {
      if (name === "gemini") return await providers.gemini!()
      // Both OpenAI-compatible providers run the same function; the context
      // decides which one the request really goes to.
      return await compatProvider.run(name === "aicredits" ? "aicredits" : "groq", () => providers.groq!())
    } catch (err) {
      logger.warn(`${label}: falling back from ${LABEL[name]}...`, err)
    }
  }

  logger.info(`${label}: using heuristic fallback`)
  return await heuristic()
}
