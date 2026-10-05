import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { heuristicMessage, type Candidate } from "./guide.rules.js"

export interface GuideAiInput {
  options: Candidate[]
  mode: "NORMAL" | "SMALLER"
  misses: number
  weekday: string
  lastSkipReasons: string[]
  thisYearGoal: string | null
}

export interface GuideAiResult {
  index: number
  message: string
  why: string
  minimum: string
  source: "ai" | "heuristic"
}

const SYSTEM_PROMPT = `You are the user's personal guide in a life app. Every night you choose ONE small thing for them to do, from a shortlist the app already checked is safe.

Rules:
- Pick exactly one option by its index. Prefer option 0 unless the context clearly favors another (e.g. recent skip reasons say "tired" → pick the lighter one).
- mode "SMALLER" means they missed recent nights: be warm, no guilt, and ask only for the minimum version.
- message: max 2 short sentences, plain words, talk like a mentor who knows them. No emoji, no hype, no exclamation marks.
- why: one sentence connecting tonight's step to their bigger goal. Use the option's "why" and their year goal if given.
- minimum: the 2-minute version of the task (keep the option's minimum if it is specific; otherwise write a concrete one).

Return JSON only: {"index": number, "message": string, "why": string, "minimum": string}`

const toPrompt = (input: GuideAiInput) =>
  JSON.stringify({
    weekday: input.weekday,
    mode: input.mode,
    missedNights: input.misses,
    recentSkipReasons: input.lastSkipReasons,
    yearGoal: input.thisYearGoal,
    options: input.options.map((o, i) => ({
      index: i,
      title: o.title,
      area: o.areaName,
      tier: o.tier,
      goal: o.goalTitle,
      why: o.why,
      minimum: o.minimum,
    })),
  })

interface Parsed {
  index?: unknown
  message?: unknown
  why?: unknown
  minimum?: unknown
}

// The AI never gets to invent a task: an out-of-range index or empty text is
// treated as a failure so the next provider (or the heuristic) answers.
const finalize = (parsed: Parsed, input: GuideAiInput): GuideAiResult => {
  const index = Number(parsed.index)
  if (!Number.isInteger(index) || index < 0 || index >= input.options.length) {
    throw new Error("Guide AI returned an invalid option index")
  }
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
  const message = text(parsed.message, 300)
  if (!message) throw new Error("Guide AI returned an empty message")
  const pick = input.options[index]!
  return {
    index,
    message,
    why: text(parsed.why, 240) || pick.why,
    minimum: text(parsed.minimum, 160) || pick.minimum,
    source: "ai",
  }
}

const viaGemini = async (input: GuideAiInput): Promise<GuideAiResult> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")
  const model = geminiClient.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  })
  const result = await model.generateContent([{ text: SYSTEM_PROMPT }, { text: toPrompt(input) }])
  return finalize(JSON.parse(result.response.text()) as Parsed, input)
}

const viaGroq = async (input: GuideAiInput): Promise<GuideAiResult> => {
  if (!groqClient) throw new Error("Groq client not initialized")
  const response = await groqClient.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: toPrompt(input) },
    ],
    model: "openai/gpt-oss-120b",
    response_format: { type: "json_object" },
  })
  return finalize(JSON.parse(response.choices[0]?.message?.content || "{}") as Parsed, input)
}

export const heuristicPick = (input: GuideAiInput, index = 0): GuideAiResult => {
  const pick = input.options[index]!
  return {
    index,
    message: heuristicMessage(pick, input.mode, input.misses),
    why: pick.why,
    minimum: pick.minimum,
    source: "heuristic",
  }
}

export const chooseTonight = (input: GuideAiInput): Promise<GuideAiResult> =>
  runWithAiFallback(
    "Guide tonight",
    {
      gemini: geminiClient ? () => viaGemini(input) : undefined,
      groq: groqClient ? () => viaGroq(input) : undefined,
    },
    () => heuristicPick(input),
  )
