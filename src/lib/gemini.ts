import { GoogleGenerativeAI } from "@google/generative-ai"
import { env } from "../config/env.config.js"
import { trackAiCall } from "./ai-usage.js"

const client = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : null

// Every Gemini model handed out records its requests in the AI usage log
// (lib/ai-usage.ts), so call sites stay as they are.
if (client) {
  const getModel = client.getGenerativeModel.bind(client)
  client.getGenerativeModel = ((params, options) => {
    const model = getModel(params, options)
    const generate = model.generateContent.bind(model)
    model.generateContent = ((request, requestOptions) =>
      trackAiCall("gemini", params.model, () => generate(request, requestOptions), (r) => {
        const u = r.response.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined
        // Thinking tokens are billed as output but reported separately, so they are added here.
        return { tokensIn: u?.promptTokenCount, tokensOut: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) }
      })) as typeof model.generateContent
    const embed = model.embedContent.bind(model)
    model.embedContent = ((request, requestOptions) =>
      trackAiCall("gemini", params.model, () => embed(request, requestOptions), () => ({}))) as typeof model.embedContent
    return model
  }) as typeof client.getGenerativeModel
}

export const geminiClient = client

// Google retires model ids often (2.0-flash on 2026-06-01; 2.5-flash was
// already "no longer available to new users" by 2026-10-07). The id comes
// from GEMINI_MODEL so a retirement is an env change, not a deploy.
// flash-lite is the default: fast (~1 s), on the free tier, and reliable
// while the larger flash models return 503 under load.
export const GEMINI_MODEL = env.GEMINI_MODEL
