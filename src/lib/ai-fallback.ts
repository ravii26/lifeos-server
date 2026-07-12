import { env } from "../config/env.config.js"
import logger from "./logger.js"

// Shared "try preferred provider → try other provider → deterministic
// heuristic" orchestration used by capture/decisions/review AI generation.
// Availability (e.g. missing API key / uninitialized client) is decided at
// the call site — pass `undefined` for a provider that isn't usable so this
// helper stays a dumb, generic loop.
interface AiFallbackProviders<T> {
  gemini?: () => Promise<T>
  groq?: () => Promise<T>
}

export async function runWithAiFallback<T>(
  label: string,
  providers: AiFallbackProviders<T>,
  heuristic: () => T | Promise<T>,
): Promise<T> {
  const order = env.PREFERRED_AI_PROVIDER === "groq"
    ? (["groq", "gemini"] as const)
    : (["gemini", "groq"] as const)

  for (const name of order) {
    const fn = providers[name]
    if (!fn) continue
    try {
      return await fn()
    } catch (err) {
      logger.warn(
        `${label}: falling back from ${name === "gemini" ? "Gemini" : "Groq"}...`,
        err,
      )
    }
  }

  logger.info(`${label}: using heuristic fallback`)
  return await heuristic()
}
