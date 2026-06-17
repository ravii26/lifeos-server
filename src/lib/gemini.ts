import { GoogleGenerativeAI } from "@google/generative-ai"
import { env } from "../config/env.config.js"

export const geminiClient = env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(env.GEMINI_API_KEY)
  : null
