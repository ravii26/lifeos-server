import { geminiClient } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { formatRagContextForPrompt, type UserRagContext } from "../../lib/rag.js"
import logger from "../../lib/logger.js"
import { env } from "../../config/env.config.js"

export type CaptureType = "TASK" | "HABIT" | "NOTE" | "RESOURCE" | "VAULT"

export interface Classification {
  type: CaptureType
  confidence: number
  worthCheck: "YES" | "MAYBE" | "NO"
  worthReason: string
  meta: {
    // All types
    title?: string              // AI-cleaned short title (better than the raw dump)

    // TASK
    priority?: "LOW" | "MEDIUM" | "HIGH"
    dueDate?: string            // ISO date string if mentioned in text

    // HABIT
    frequency?: "DAILY" | "WEEKLY" | "CUSTOM"
    targetCount?: number
    targetMinutes?: number

    // Area suggestion (TASK / HABIT)
    suggestedAreaId?: string
    suggestedAreaName?: string

    // Topic suggestion (NOTE / RESOURCE)
    suggestedTopicId?: string
    suggestedTopicName?: string

    // RESOURCE
    url?: string
    platform?: string
    resourceType?: "ARTICLE" | "VIDEO" | "BOOK" | "COURSE" | "PODCAST" | "OTHER"

    // NOTE / RESOURCE
    tags?: string[]
  }
}

// ── Heuristic fallback (no API key needed) ────────────────────────────────

const URL_RE = /https?:\/\/|\b[\w-]+\.(com|io|dev|org|net|ai)\b/i

const hasAny = (text: string, words: string[]): boolean =>
  words.some((w) => text.includes(w))

const extractUrl = (raw: string): string | undefined => {
  const match = raw.match(/https?:\/\/[^\s]+|\b[\w-]+\.(?:com|io|dev|org|net|ai)\b/i)
  return match?.[0]
}

const detectPlatform = (url: string): string | undefined => {
  if (/youtube\.com|youtu\.be/i.test(url)) return "YouTube"
  if (/udemy\.com/i.test(url)) return "Udemy"
  if (/coursera\.org/i.test(url)) return "Coursera"
  if (/medium\.com/i.test(url)) return "Medium"
  if (/github\.com/i.test(url)) return "GitHub"
  if (/twitter\.com|x\.com/i.test(url)) return "Twitter"
  return undefined
}

const detectResourceType = (url: string | undefined, text: string): Classification["meta"]["resourceType"] => {
  if (url && /youtube|youtu\.be/i.test(url)) return "VIDEO"
  if (/\bbook\b|\bnovel\b/i.test(text)) return "BOOK"
  if (/\bcourse\b|\budemy\b|\bcoursera\b/i.test(text)) return "COURSE"
  if (/\bpodcast\b/i.test(text)) return "PODCAST"
  if (url) return "ARTICLE"
  return "OTHER"
}

const heuristicClassify = (rawText: string, ctx?: UserRagContext): Classification => {
  const t = rawText.toLowerCase()
  const url = extractUrl(rawText)

  if (URL_RE.test(t) || hasAny(t, ["guideline", "guidelines", "article", "docs", "documentation"])) {
    const platform = url ? detectPlatform(url) : undefined
    return {
      type: "RESOURCE",
      confidence: 0.9,
      worthCheck: "YES",
      worthReason: "Contains a URL or reference to a document worth reading.",
      meta: { tags: ["reading"], url, platform, resourceType: detectResourceType(url, t) },
    }
  }
  if (hasAny(t, ["every day", "daily", "each morning", "habit", "routine", "meditat", "each day"])) {
    const suggestedArea = ctx?.areas.find((a) =>
      hasAny(t, [a.name.toLowerCase()]),
    )
    return {
      type: "HABIT",
      confidence: 0.85,
      worthCheck: "YES",
      worthReason: "Repeating action — building this as a habit creates long-term compound gains.",
      meta: {
        frequency: "DAILY",
        suggestedAreaId: suggestedArea?.id,
        suggestedAreaName: suggestedArea?.name,
      },
    }
  }
  if (hasAny(t, ["grateful", "proud", "i remember", "remember when", "quote", "win:"])) {
    return {
      type: "VAULT",
      confidence: 0.74,
      worthCheck: "YES",
      worthReason: "A reflection or memory worth keeping for motivation.",
      meta: {},
    }
  }
  if (hasAny(t, ["idea", "idea:", "thought", "remember that", "insight", "note:"])) {
    const suggestedTopic = ctx?.topics.find((tp) =>
      t.includes(tp.title.toLowerCase()),
    )
    return {
      type: "NOTE",
      confidence: 0.78,
      worthCheck: "MAYBE",
      worthReason: "An idea or insight that may be worth developing further.",
      meta: {
        tags: ["idea"],
        suggestedTopicId: suggestedTopic?.id,
        suggestedTopicName: suggestedTopic?.title,
      },
    }
  }
  if (hasAny(t, ["read", "learn", "study", "course", "book", "watch"])) {
    return {
      type: "RESOURCE",
      confidence: 0.81,
      worthCheck: "YES",
      worthReason: "A learning resource to consume.",
      meta: { tags: ["learning"], resourceType: detectResourceType(undefined, t) },
    }
  }

  // Default to TASK — most brain dumps are things to do
  const suggestedArea = ctx?.areas.find((a) => t.includes(a.name.toLowerCase()))
  return {
    type: "TASK",
    confidence: 0.8,
    worthCheck: "MAYBE",
    worthReason: "Looks like an action item to complete.",
    meta: {
      priority: "MEDIUM",
      suggestedAreaId: suggestedArea?.id,
      suggestedAreaName: suggestedArea?.name,
    },
  }
}

// ── Gemini classifier ─────────────────────────────────────────────────────

const buildSystemPrompt = (ctx?: UserRagContext): string => {
  const contextBlock = ctx ? formatRagContextForPrompt(ctx) : "None"

  return `You are the core AI triage agent of LifeOS, a personal operating system.
Your mission is to classify a raw, unstructured brain-dump text into one of the designated categories, clean up the text, extract metadata, and link it to the user's existing life areas or learning topics where relevant.

<user_context>
${contextBlock}
</user_context>

<classification_categories>
- TASK: A one-off, actionable item to complete (e.g., "buy milk", "reply to boss's email").
- HABIT: A recurring activity performed regularly (e.g., "go running every morning", "read 20 mins daily").
- NOTE: A static piece of information, insight, thought, or idea (e.g., "idea for app project", "thoughts on today's lecture").
- RESOURCE: A specific learning materials reference such as a book, article, video, course, or podcast (often has a URL).
- VAULT: A reflection, memory, gratitude entry, or inspirational quote to preserve long-term.
</classification_categories>

<rules>
1. Match the item to a user area or topic in <user_context> based on semantic relevance.
2. If no clear relevance is found, set suggestedAreaId/suggestedTopicId to null.
3. Clean the raw text to produce a concise, professional title (max 120 characters) in 'meta.title'.
4. Perform structural extraction: extract dates, recurring frequencies, URLs, platforms, tags, etc.
5. Respond with a raw JSON object matching the schema below.
6. Do NOT wrap your response in markdown code blocks (such as \`\`\`json). Output raw JSON only.
</rules>

<output_schema>
{
  "type": "TASK" | "HABIT" | "NOTE" | "RESOURCE" | "VAULT",
  "confidence": number, // Float between 0.0 and 1.0 representing classification confidence
  "worthCheck": "YES" | "MAYBE" | "NO", // Assessment of whether the item is high priority or high value
  "worthReason": "string", // Single sentence explanation for worthCheck rating
  "meta": {
    "title": "string", // Cleaned, capitalized short title
    "priority": "LOW" | "MEDIUM" | "HIGH", // (For TASK only)
    "dueDate": "string" | null, // ISO Date string YYYY-MM-DD (For TASK only, if date mentioned)
    "frequency": "DAILY" | "WEEKLY" | "CUSTOM" | null, // (For HABIT only)
    "targetMinutes": number | null, // (For HABIT only, duration in minutes if mentioned)
    "suggestedAreaId": "string" | null, // Area ID matching user areas
    "suggestedAreaName": "string" | null, // Area Name matching user areas
    "suggestedTopicId": "string" | null, // Topic ID matching user topics (NOTE or RESOURCE only)
    "suggestedTopicName": "string" | null, // Topic Name matching user topics (NOTE or RESOURCE only)
    "url": "string" | null, // Extracted URL
    "platform": "YouTube" | "Udemy" | "Coursera" | "Medium" | "GitHub" | "Twitter" | null,
    "resourceType": "ARTICLE" | "VIDEO" | "BOOK" | "COURSE" | "PODCAST" | "OTHER" | null, // (For RESOURCE only)
    "tags": string[] // Suggested tags (max 3, NOTE or RESOURCE only)
  }
}
</output_schema>`
}

const geminiClassify = async (rawText: string, ctx?: UserRagContext): Promise<Classification> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")

  try {
    const model = geminiClient.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { responseMimeType: "application/json" },
    })

    const result = await model.generateContent([
      { text: buildSystemPrompt(ctx) },
      { text: `Brain dump: "${rawText}"` },
    ])

    logger.debug(`Gemini response: ${result.response.text()}`);

    const parsed = JSON.parse(result.response.text()) as {
      type: CaptureType
      confidence: number
      worthCheck?: "YES" | "MAYBE" | "NO"
      worthReason?: string
      meta: Classification["meta"]
    }

    const validTypes: CaptureType[] = ["TASK", "HABIT", "NOTE", "RESOURCE", "VAULT"]
    if (!validTypes.includes(parsed.type)) throw new Error("invalid type from Gemini")

    return {
      type: parsed.type,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.8)),
      worthCheck: parsed.worthCheck ?? "MAYBE",
      worthReason: parsed.worthReason ?? "",
      meta: parsed.meta ?? {},
    }
  } catch (error) {
    logger.error("Gemini capture classification failed:", error)
    throw error
  }
}

const groqClassify = async (rawText: string, ctx?: UserRagContext): Promise<Classification> => {
  if (!groqClient) throw new Error("Groq client not initialized")

  try {
    const response = await groqClient.chat.completions.create({
      messages: [
        { role: "system", content: buildSystemPrompt(ctx) },
        { role: "user", content: `Brain dump: "${rawText}"` },
      ],
      model: "openai/gpt-oss-120b",
      response_format: { type: "json_object" },
    })

    const text = response.choices[0]?.message?.content || ""
    logger.debug(`Groq responsse: ${text}`)

    const parsed = JSON.parse(text) as {
      type: CaptureType
      confidence: number
      worthCheck?: "YES" | "MAYBE" | "NO"
      worthReason?: string
      meta: Classification["meta"]
    }

    const validTypes: CaptureType[] = ["TASK", "HABIT", "NOTE", "RESOURCE", "VAULT"]
    if (!validTypes.includes(parsed.type)) throw new Error("invalid type from Groq")

    return {
      type: parsed.type,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.8)),
      worthCheck: parsed.worthCheck ?? "MAYBE",
      worthReason: parsed.worthReason ?? "",
      meta: parsed.meta ?? {},
    }
  } catch (error) {
    logger.error("Groq capture classification failed:", error)
    throw error
  }
}

/**
 * Classify a raw capture. Uses Preferred AI Provider (Gemini or Groq) with fallback,
 * otherwise falls back to the deterministic heuristic.
 */
export const classifyCapture = async (rawText: string, ctx?: UserRagContext): Promise<Classification> => {
  const preferred = env.PREFERRED_AI_PROVIDER
  const providers = preferred === "groq" ? ["groq", "gemini"] : ["gemini", "groq"]

  for (const provider of providers) {
    if (provider === "gemini" && geminiClient) {
      try {
        return await geminiClassify(rawText, ctx)
      } catch (err) {
        logger.warn("Falling back from Gemini capture classifier...")
      }
    }
    if (provider === "groq" && groqClient) {
      try {
        return await groqClassify(rawText, ctx)
      } catch (err) {
        logger.warn("Falling back from Groq capture classifier...")
      }
    }
  }

  logger.info("Using heuristic capture classifier fallback")
  return heuristicClassify(rawText, ctx)
}
