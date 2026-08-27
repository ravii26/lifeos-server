import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"

// The period stats the narrative is written from. Pure data in, prose out.
export interface ReviewStatsForAi {
  periodLabel: string // "day" | "week" | "month" | "year"
  tasksCompleted: number
  habitsLogged: number
  focusMinutes: number
  topStreaks: { title: string; streak: number }[]
  areaScores: { name: string; score: number }[]
  activeGoals: { title: string; confidence: number; label: string }[]
}

export interface ReviewInsights {
  narrative: string // warm 2-4 sentence reflection on the period
  observations: string[] // 2-5 concrete, data-grounded bullets
  source: "ai" | "heuristic"
}

// ── Heuristic fallback (no API key needed) ────────────────────────────────────

const heuristicInsights = (s: ReviewStatsForAi): ReviewInsights => {
  const observations: string[] = []
  observations.push(
    `Completed ${s.tasksCompleted} task(s) and logged ${s.habitsLogged} habit check-in(s) this ${s.periodLabel}.`,
  )
  if (s.focusMinutes > 0) observations.push(`Focused for ${Math.round(s.focusMinutes)} minute(s).`)

  const bestStreak = [...s.topStreaks].sort((a, b) => b.streak - a.streak)[0]
  if (bestStreak && bestStreak.streak > 0) {
    observations.push(`Strongest habit: "${bestStreak.title}" at a ${bestStreak.streak}-day streak.`)
  }

  const weakestArea = [...s.areaScores].sort((a, b) => a.score - b.score)[0]
  if (weakestArea) {
    observations.push(`"${weakestArea.name}" is your lowest area at ${weakestArea.score}/100.`)
  }

  const offTrack = s.activeGoals.find((g) => g.label === "OFF_TRACK")
  if (offTrack) {
    observations.push(`Goal "${offTrack.title}" is off track (confidence ${offTrack.confidence}/100).`)
  }

  const idle = s.tasksCompleted + s.habitsLogged === 0
  const narrative = idle
    ? `A quiet ${s.periodLabel} — nothing was logged. No judgement; a fresh start is just one small action away.`
    : `This ${s.periodLabel} you completed ${s.tasksCompleted} task(s) and kept ${s.habitsLogged} habit check-in(s) going${
        s.focusMinutes > 0 ? `, with ${Math.round(s.focusMinutes)} focused minutes` : ""
      }. ${
        bestStreak && bestStreak.streak > 0 ? `"${bestStreak.title}" is building real momentum. ` : ""
      }${weakestArea ? `Consider giving "${weakestArea.name}" more attention next ${s.periodLabel}.` : ""}`

  return { narrative: narrative.trim(), observations, source: "heuristic" }
}

// ── AI prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the reflection coach of LifeOS, a personal operating system.
You are given a factual JSON snapshot of what the user actually did over a review period (tasks completed, habit check-ins, focus minutes, habit streaks, life-area scores, and active-goal confidence). Write an honest, warm, specific reflection.

<rules>
1. Output raw JSON only — no markdown code fences.
2. Ground every statement in the numbers provided. Never invent activities or data.
3. Be direct: name what went well AND what slipped. Do not flatter.
4. Second person ("you"), specific, never generic or corporate.
5. "narrative": 2-4 sentences tying the period together. "observations": 2-5 short, concrete bullets.
</rules>

<output_schema>
{ "narrative": "string", "observations": ["string", ...] }
</output_schema>`

interface ParsedReviewAi {
  narrative?: string
  observations?: string[]
}

const finalize = (parsed: ParsedReviewAi, s: ReviewStatsForAi): ReviewInsights => {
  const fallback = heuristicInsights(s)
  return {
    narrative: parsed.narrative?.trim() || fallback.narrative,
    observations:
      Array.isArray(parsed.observations) && parsed.observations.length
        ? parsed.observations.slice(0, 5)
        : fallback.observations,
    source: "ai",
  }
}

const geminiInsights = async (s: ReviewStatsForAi): Promise<ReviewInsights> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")
  const model = geminiClient.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  })
  const result = await model.generateContent([
    { text: SYSTEM_PROMPT },
    { text: `Review period stats: ${JSON.stringify(s)}` },
  ])
  return finalize(JSON.parse(result.response.text()) as ParsedReviewAi, s)
}

const groqInsights = async (s: ReviewStatsForAi): Promise<ReviewInsights> => {
  if (!groqClient) throw new Error("Groq client not initialized")
  const response = await groqClient.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Review period stats: ${JSON.stringify(s)}` },
    ],
    model: "openai/gpt-oss-120b",
    response_format: { type: "json_object" },
  })
  const text = response.choices[0]?.message?.content || ""
  return finalize(JSON.parse(text) as ParsedReviewAi, s)
}

/**
 * Generate the review narrative + observations. Mirrors the capture/decisions
 * pattern: preferred provider → fallback provider → deterministic heuristic.
 */
export const generateReviewInsights = async (s: ReviewStatsForAi): Promise<ReviewInsights> =>
  runWithAiFallback(
    "Review insights",
    {
      gemini: geminiClient ? () => geminiInsights(s) : undefined,
      groq: groqClient ? () => groqInsights(s) : undefined,
    },
    () => heuristicInsights(s),
  )
