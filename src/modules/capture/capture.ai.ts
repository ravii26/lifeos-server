import { geminiClient } from "../../lib/gemini.js"

export type CaptureType = "TASK" | "HABIT" | "NOTE" | "RESOURCE" | "VAULT"

export interface Classification {
  type: CaptureType
  confidence: number
  meta: Record<string, unknown>
}

// ── Heuristic fallback (no API key needed) ────────────────────────────────

const URL_RE = /https?:\/\/|\b[\w-]+\.(com|io|dev|org|net|ai)\b/i

const hasAny = (text: string, words: string[]): boolean =>
  words.some((w) => text.includes(w))

const extractUrl = (raw: string): string | undefined => {
  const match = raw.match(/https?:\/\/[^\s]+|\b[\w-]+\.(?:com|io|dev|org|net|ai)\b/i)
  return match?.[0]
}

const heuristicClassify = (rawText: string): Classification => {
  const t = rawText.toLowerCase()

  if (URL_RE.test(t) || hasAny(t, ["guideline", "guidelines", "article", "docs", "documentation"])) {
    return { type: "RESOURCE", confidence: 0.9, meta: { tags: ["reading"], url: extractUrl(rawText) } }
  }
  if (hasAny(t, ["every day", "daily", "each morning", "habit", "routine", "meditat", "each day"])) {
    return { type: "HABIT", confidence: 0.85, meta: { cadence: "DAILY" } }
  }
  if (hasAny(t, ["grateful", "proud", "i remember", "remember when", "quote", "win:"])) {
    return { type: "VAULT", confidence: 0.74, meta: {} }
  }
  if (hasAny(t, ["idea", "idea:", "thought", "remember that", "insight", "note:"])) {
    return { type: "NOTE", confidence: 0.78, meta: { tags: ["idea"] } }
  }
  if (hasAny(t, ["read", "learn", "study", "course", "book", "watch"])) {
    return { type: "RESOURCE", confidence: 0.81, meta: { tags: ["learning"] } }
  }
  return { type: "TASK", confidence: 0.8, meta: { priority: "MEDIUM" } }
}

// ── Gemini classifier ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a personal productivity assistant. Given a raw brain-dump text, classify it into exactly one of these five types:
- TASK: something actionable to do once (e.g. "email John", "fix the login bug", "buy groceries")
- HABIT: something to do repeatedly (e.g. "meditate every morning", "read daily", "exercise")
- NOTE: an idea, thought, or insight worth capturing (e.g. "idea for a new feature", "I think the issue is X")
- RESOURCE: something to read, watch, or learn from (e.g. URLs, books, courses, articles)
- VAULT: a memory, reflection, gratitude, or motivational quote to keep

Respond with a JSON object ONLY, no markdown. Shape:
{
  "type": "TASK" | "HABIT" | "NOTE" | "RESOURCE" | "VAULT",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<one sentence>",
  "meta": {
    "priority": "LOW" | "MEDIUM" | "HIGH",   (for TASK)
    "cadence": "DAILY" | "WEEKLY" | "CUSTOM", (for HABIT)
    "tags": ["tag1"],                          (for NOTE/RESOURCE)
    "url": "<url if detected>"                 (for RESOURCE)
  }
}`

const geminiClassify = async (rawText: string): Promise<Classification> => {
  if (!geminiClient) return heuristicClassify(rawText)

  try {
    const model = geminiClient.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { responseMimeType: "application/json" },
    })

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: `Brain dump: "${rawText}"` },
    ])

    const raw = result.response.text()
    const parsed = JSON.parse(raw) as {
      type: CaptureType
      confidence: number
      meta: Record<string, unknown>
    }

    const validTypes: CaptureType[] = ["TASK", "HABIT", "NOTE", "RESOURCE", "VAULT"]
    if (!validTypes.includes(parsed.type)) throw new Error("invalid type from Gemini")

    return {
      type: parsed.type,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.8)),
      meta: parsed.meta ?? {},
    }
  } catch {
    // Gemini failed — fall back to heuristic silently
    return heuristicClassify(rawText)
  }
}

/**
 * Classify a raw capture. Uses Gemini when GEMINI_API_KEY is set,
 * otherwise falls back to the deterministic heuristic (no cost, no latency).
 */
export const classifyCapture = (rawText: string): Promise<Classification> =>
  geminiClient ? geminiClassify(rawText) : Promise.resolve(heuristicClassify(rawText))
