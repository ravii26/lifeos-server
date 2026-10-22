import { env } from "../config/env.config.js"
import { aiCreditsAllowed, compatProvider } from "./aicredits.js"
import logger from "./logger.js"
import { withAiFeature } from "./ai-usage.js"

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

// ---- temporary errors are retried, dead providers are skipped for a while ------------------
// A free Gemini tier answers "503 busy" for a second or two now and then. Giving up at once
// meant planning failed whenever the other two providers were also unusable, so a temporary
// error is retried on the same provider. A bad key (401), no balance (402) or a refusal (403)
// will not fix itself in seconds, so that provider is skipped for a few minutes instead of
// being tried, and failing, on every message.

const DEAD = /\b(?:401|402|403)\b|insufficient balance|invalid api key|expired_api_key|permission denied/i
const TRANSIENT = /\b(?:429|500|502|503|504)\b|overloaded|high demand|service unavailable|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|timed? ?out/i

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export const isDeadError = (err: unknown): boolean => DEAD.test(messageOf(err))
export const isTransientError = (err: unknown): boolean => TRANSIENT.test(messageOf(err)) && !DEAD.test(messageOf(err))

export const RETRY_DELAYS_MS = [1200, 3000]
export const DEAD_FOR_MS = 5 * 60_000

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  delays: number[] = RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i >= delays.length || !isTransientError(err)) throw err
      await sleep(delays[i]!)
    }
  }
}

const deadUntil = new Map<AiProviderName, number>()
// For tests.
export const resetDeadProviders = () => deadUntil.clear()

// Every request made inside is logged under `label` (lib/ai-usage.ts).
export function runWithAiFallback<T>(
  label: string,
  providers: AiFallbackProviders<T>,
  heuristic: () => T | Promise<T>,
): Promise<T> {
  return withAiFeature(label, () => tryProviders(label, providers, heuristic))
}

async function tryProviders<T>(
  label: string,
  providers: AiFallbackProviders<T>,
  heuristic: () => T | Promise<T>,
): Promise<T> {
  const order = providerOrder(env.PREFERRED_AI_PROVIDER, {
    aicredits: !!providers.groq && aiCreditsAllowed(),
    gemini: !!providers.gemini,
    groq: !!providers.groq && !!env.GROQ_API_KEY,
  })

  // Skip providers that just failed for good, unless that would leave none (then try them all).
  const live = order.filter((n) => (deadUntil.get(n) ?? 0) <= Date.now())

  for (const name of live.length ? live : order) {
    try {
      if (name === "gemini") return await callWithRetry(() => providers.gemini!())
      // Both OpenAI-compatible providers run the same function; the context
      // decides which one the request really goes to.
      return await callWithRetry(() => compatProvider.run(name === "aicredits" ? "aicredits" : "groq", () => providers.groq!()))
    } catch (err) {
      if (isDeadError(err)) deadUntil.set(name, Date.now() + DEAD_FOR_MS)
      logger.warn(`${label}: falling back from ${LABEL[name]}...`, err)
    }
  }

  logger.info(`${label}: using heuristic fallback`)
  return await heuristic()
}
