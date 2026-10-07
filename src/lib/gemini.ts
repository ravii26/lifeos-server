import { GoogleGenerativeAI } from "@google/generative-ai"
import { env } from "../config/env.config.js"

export const geminiClient = env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(env.GEMINI_API_KEY)
  : null

// Google retires model ids often (2.0-flash on 2026-06-01; 2.5-flash was
// already "no longer available to new users" by 2026-10-07). The id comes
// from GEMINI_MODEL so a retirement is an env change, not a deploy.
// flash-lite is the default: fast (~1 s), on the free tier, and reliable
// while the larger flash models return 503 under load.
export const GEMINI_MODEL = env.GEMINI_MODEL
