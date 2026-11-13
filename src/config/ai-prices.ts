/* =====================================================================
   AI prices for the admin page's cost estimate, in US dollars per
   1 million tokens. Cost is worked out when the page is read, so changing
   a price here (or in AI_PRICES_JSON on the server) updates past days too.

   Check these against the provider's own price page before trusting the
   rupee numbers. Last checked 2026-11 against the official Gemini, Groq,
   OpenAI and Anthropic pages (reports/Ally situations cost and UX.md).
   Embeddings and Whisper are not per-token chat prices and stay unset, so
   the page shows "price not set" for them rather than a wrong number.
   ===================================================================== */
import { env } from "./env.config.js"

export interface ModelPrice {
  inPerM: number
  outPerM: number
}

// AICredits bills list price plus a 10.25% margin (research, Nov 2026), so its
// rows are the list price × 1.1025. Model ids are the ones each provider is
// actually called with: Gemini direct is unprefixed, AICredits is prefixed.
const AICREDITS_MARGIN = 1.1025
const viaAiCredits = (inPerM: number, outPerM: number): ModelPrice => ({ inPerM: inPerM * AICREDITS_MARGIN, outPerM: outPerM * AICREDITS_MARGIN })

const DEFAULT_PRICES: Record<string, ModelPrice> = {
  // Gemini direct (list price, Nov 2026).
  "gemini-3.5-flash-lite": { inPerM: 0.3, outPerM: 2.5 },
  // AICredits (list price + margin).
  "google/gemini-3.5-flash-lite": viaAiCredits(0.3, 2.5),
  "openai/gpt-4o-mini": viaAiCredits(0.15, 0.6),
  "anthropic/claude-haiku-4.5": viaAiCredits(1, 5),
  // Groq's paid list price. The free tier bills nothing, but counting it at
  // list price keeps the page honest about what the same traffic costs once
  // the free quota runs out. Override with AI_PRICES_JSON if staying free.
  "openai/gpt-oss-120b": { inPerM: 0.15, outPerM: 0.6 },
}

// AI_PRICES_JSON='{"openai/gpt-4o-mini":{"inPerM":0.15,"outPerM":0.6}}' adds or overrides models.
const fromEnv = (): Record<string, ModelPrice> => {
  if (!env.AI_PRICES_JSON) return {}
  try {
    return JSON.parse(env.AI_PRICES_JSON) as Record<string, ModelPrice>
  } catch {
    return {}
  }
}

export const modelPrices = (): Record<string, ModelPrice> => ({ ...DEFAULT_PRICES, ...fromEnv() })

// null when the model has no price yet, so the page can say "price not set"
// instead of showing a made-up zero.
export const costInr = (
  model: string,
  tokensIn: number,
  tokensOut: number,
  prices = modelPrices(),
  usdInr = env.AI_USD_INR,
): number | null => {
  const p = prices[model]
  if (!p) return null
  return ((tokensIn * p.inPerM + tokensOut * p.outPerM) / 1_000_000) * usdInr
}
