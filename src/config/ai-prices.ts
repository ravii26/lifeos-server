/* =====================================================================
   AI prices for the admin page's cost estimate, in US dollars per
   1 million tokens. Cost is worked out when the page is read, so changing
   a price here (or in AI_PRICES_JSON on the server) updates past days too.

   Check these against the provider's own price page before trusting the
   rupee numbers. Last looked up 2026-10-15 from third-party trackers
   (pricepertoken.com) because Google's page could not be read.
   AICredits may add a margin on top; set its real rate in AI_PRICES_JSON
   once known.
   ===================================================================== */
import { env } from "./env.config.js"

export interface ModelPrice {
  inPerM: number
  outPerM: number
}

const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "gemini-3.5-flash-lite": { inPerM: 0.3, outPerM: 2.5 },
  "google/gemini-3.5-flash-lite": { inPerM: 0.3, outPerM: 2.5 },
  // Groq's free tier: nothing is billed.
  "openai/gpt-oss-120b": { inPerM: 0, outPerM: 0 },
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
