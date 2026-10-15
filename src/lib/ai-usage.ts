/* =====================================================================
   AI usage log: one AiCall row per request to any provider, so the admin
   page can show tokens, cost and failures per feature.

   Who and what a call is for travels in an AsyncLocalStorage instead of
   being passed through every call site: the auth middleware sets the user,
   `runWithAiFallback` (or `withAiFeature`) sets the feature, and the
   provider clients (lib/gemini.ts, lib/groq.ts) record the call. So every
   module is covered without changing its code.
   ===================================================================== */
import { AsyncLocalStorage } from "node:async_hooks"
import prisma from "./prisma.js"
import logger from "./logger.js"

interface AiContext {
  userId?: string
  feature?: string
}

const aiContext = new AsyncLocalStorage<AiContext>()

// Called once per authenticated request: everything that request starts,
// including background work it kicks off, belongs to this user.
export const enterAiUser = (userId: string) => {
  aiContext.enterWith({ ...aiContext.getStore(), userId })
}

export const withAiFeature = <T>(feature: string, fn: () => Promise<T>): Promise<T> =>
  aiContext.run({ ...aiContext.getStore(), feature }, fn)

export const withAiUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
  aiContext.run({ ...aiContext.getStore(), userId }, fn)

export interface AiCallRecord {
  provider: "aicredits" | "gemini" | "groq"
  model: string
  tokensIn?: number
  tokensOut?: number
  durationMs: number
  ok: boolean
  error?: string
}

// Never throws and never delays the answer: a failed log write only logs.
export const recordAiCall = (rec: AiCallRecord): void => {
  const ctx = aiContext.getStore()
  void prisma.aiCall
    .create({
      data: {
        userId: ctx?.userId ?? null,
        feature: ctx?.feature ?? "Other",
        provider: rec.provider,
        model: rec.model.slice(0, 120),
        tokensIn: Math.max(0, Math.round(rec.tokensIn ?? 0)),
        tokensOut: Math.max(0, Math.round(rec.tokensOut ?? 0)),
        durationMs: Math.max(0, Math.round(rec.durationMs)),
        ok: rec.ok,
        error: rec.error?.slice(0, 500) ?? null,
      },
    })
    .catch((err) => logger.warn("Could not record AI call", err))
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Times one request and records it, success or failure. `usage` reads the
// token counts out of the provider's response.
export const trackAiCall = async <T>(
  provider: AiCallRecord["provider"],
  model: string,
  call: () => Promise<T>,
  usage: (result: T) => { tokensIn?: number; tokensOut?: number; model?: string },
): Promise<T> => {
  const started = Date.now()
  try {
    const result = await call()
    let u: ReturnType<typeof usage> = {}
    try {
      u = usage(result)
    } catch {
      // A response without usage data is still a successful call.
    }
    recordAiCall({ provider, model: u.model ?? model, tokensIn: u.tokensIn, tokensOut: u.tokensOut, durationMs: Date.now() - started, ok: true })
    return result
  } catch (err) {
    recordAiCall({ provider, model, durationMs: Date.now() - started, ok: false, error: message(err) })
    throw err
  }
}
