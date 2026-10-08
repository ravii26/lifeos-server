/* =====================================================================
   AICredits (https://aicredits.in): an OpenAI-compatible gateway over many
   models with INR billing, used as one more AI provider next to Gemini and
   Groq (ADR 0020). Same request and response shape as OpenAI chat
   completions, Bearer auth. Each call tries the candidate models in order,
   and a daily call cap protects the purchased credits.
   ===================================================================== */
import { AsyncLocalStorage } from "node:async_hooks"
import { env } from "../config/env.config.js"
import logger from "./logger.js"

export const aiCreditsConfigured = !!env.AICREDITS_API_KEY

// Cheap and reliable first (the same model as the Gemini default, then a very
// cheap OpenAI one, then Claude Haiku). Override with AICREDITS_MODELS
// (comma-separated, provider-prefixed ids as listed on aicredits.in/models).
const DEFAULT_MODELS = ["google/gemini-3.5-flash-lite", "openai/gpt-4o-mini", "anthropic/claude-haiku-4.5"]

export const aiCreditsModels = (): string[] => {
  const fromEnv = env.AICREDITS_MODELS?.split(",").map((m) => m.trim()).filter(Boolean)
  return fromEnv?.length ? fromEnv : DEFAULT_MODELS
}

// ---- which OpenAI-compatible provider a call is for ----------------------------
// The AI call sites all speak the same chat format (they were written for
// Groq). `runWithAiFallback` runs that same function once for AICredits by
// setting this context; `groqClient` (lib/groq.ts) reads it to decide where
// the request goes. That way every module gained AICredits without a change.
export const compatProvider = new AsyncLocalStorage<"groq" | "aicredits">()

// ---- the daily cap ------------------------------------------------------------------
let day = ""
let calls = 0

const today = () => new Date().toISOString().slice(0, 10)

// A soft cap per server process: AICredits is paid, so a runaway loop or a
// flood of messages cannot spend the balance; past the cap the next provider answers.
export const aiCreditsAllowed = (): boolean => {
  if (!aiCreditsConfigured) return false
  if (day !== today()) {
    day = today()
    calls = 0
  }
  return calls < env.AICREDITS_DAILY_CALL_LIMIT
}

export const _resetAiCreditsCounter = () => {
  day = ""
  calls = 0
}

// ---- the call -------------------------------------------------------------------------
interface ChatParams {
  messages: { role: string; content: string }[]
  temperature?: number
  max_tokens?: number
  response_format?: { type: string }
  [key: string]: unknown
}

export interface ChatResult {
  choices: { message: { content: string | null }; finish_reason?: string }[]
}

export interface AiCreditsAttempt {
  model: string
  status?: number
  detail: string
}

export class AiCreditsError extends Error {
  attempts: AiCreditsAttempt[]
  constructor(attempts: AiCreditsAttempt[]) {
    super(`AICredits failed on every model: ${attempts.map((a) => `${a.model} (${a.status ?? "network"}): ${a.detail}`).join("; ")}`)
    this.name = "AiCreditsError"
    this.attempts = attempts
  }
}

const TIMEOUT_MS = 60_000
const ENDPOINT = "https://api.aicredits.in/v1/chat/completions"

export const aiCreditsChat = async (params: ChatParams): Promise<ChatResult> => {
  if (!env.AICREDITS_API_KEY) throw new Error("AICredits is not configured")
  if (!aiCreditsAllowed()) throw new Error("AICredits daily call limit reached")
  calls++
  const attempts: AiCreditsAttempt[] = []
  const json = params.response_format?.type === "json_object"

  for (const model of aiCreditsModels()) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${env.AICREDITS_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: params.messages,
          temperature: params.temperature ?? 0.3,
          ...(params.response_format ? { response_format: params.response_format } : {}),
          ...(params.max_tokens ? { max_tokens: params.max_tokens } : {}),
        }),
      })
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 300)
        attempts.push({ model, status: res.status, detail: body || res.statusText })
        continue
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null }; finish_reason?: string }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const choice = data.choices?.[0]
      const content = choice?.message?.content
      // A reply cut off at the length limit is broken JSON: try the next model.
      if (content && choice?.finish_reason === "length" && json) {
        attempts.push({ model, status: res.status, detail: "reply was cut off at the length limit" })
        continue
      }
      if (!content) {
        attempts.push({ model, status: res.status, detail: "response had no message content" })
        continue
      }
      logger.info(`AICredits ${model}: ${data.usage?.prompt_tokens ?? "?"} in, ${data.usage?.completion_tokens ?? "?"} out`)
      return { choices: [{ message: { content }, finish_reason: choice?.finish_reason }] }
    } catch (err) {
      attempts.push({ model, detail: err instanceof Error ? err.message : String(err) })
    } finally {
      clearTimeout(timer)
    }
  }
  throw new AiCreditsError(attempts)
}
