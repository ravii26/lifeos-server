import { GoogleGenerativeAI } from "@google/generative-ai"
import { env } from "../config/env.config.js"

export const geminiClient = env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(env.GEMINI_API_KEY)
  : null

// gemini-2.0-flash was retired by Google on 2026-06-01. Track the current
// model here so retirements (2.5-flash is scheduled to retire 2026-10-16)
// are a one-line change instead of a repo-wide grep-and-replace.
export const GEMINI_MODEL = "gemini-2.5-flash"
