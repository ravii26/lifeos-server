import Groq from "groq-sdk"
import { env } from "../config/env.config.js"
import { aiCreditsChat, aiCreditsConfigured, compatProvider } from "./aicredits.js"

const realGroq = env.GROQ_API_KEY ? new Groq({ apiKey: env.GROQ_API_KEY }) : null

// Every AI call site was written for Groq's OpenAI-style chat API and reaches
// it through `groqClient.chat.completions.create`. So that AICredits (also
// OpenAI-compatible) works in all of them without touching them, this is a
// thin router: inside `runWithAiFallback`'s AICredits attempt (see
// lib/aicredits.ts, `compatProvider`) the same call goes to AICredits; any
// other time it goes to Groq. Only `chat.completions.create` and
// `audio.transcriptions.create` are used by the app, and audio is always Groq.
const router = {
  chat: {
    completions: {
      create: (params: Parameters<typeof aiCreditsChat>[0]) =>
        compatProvider.getStore() === "aicredits"
          ? aiCreditsChat(params)
          : realGroq
            ? realGroq.chat.completions.create(params as never)
            : Promise.reject(new Error("Groq is not configured")),
    },
  },
  get audio() {
    if (!realGroq) throw new Error("Groq is not configured (audio transcription needs a Groq key)")
    return realGroq.audio
  },
}

// Non-null when either Groq or AICredits is configured, so the call sites'
// existing `groqClient ? … : undefined` checks keep working.
export const groqClient = (realGroq || aiCreditsConfigured ? router : null) as unknown as Groq | null
