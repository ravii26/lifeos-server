import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import type { RagNow } from "../../lib/rag.js"
import logger from "../../lib/logger.js"

export type ExtractItemType = "HABIT" | "GOAL" | "TASK"

export interface ExtractedItem {
  itemType: ExtractItemType
  title: string
  detail?: string
  confidence: number
  sourceHeading?: string
  suggestedAreaName?: string
  // HABIT
  frequency?: "DAILY" | "WEEKLY" | "CUSTOM"
  targetMinutes?: number
  // TASK / GOAL
  priority?: "LOW" | "MEDIUM" | "HIGH"
  // TASK
  dueDate?: string
}

const MAX_ITEMS = 12
const MAX_TEXT = 100_000 // cap chars sent to the model (well within Flash's context)
const VALID_TYPES: ExtractItemType[] = ["HABIT", "GOAL", "TASK"]

const buildPrompt = (areaNames: string[], now: RagNow): string => `You are the planning agent of LifeOS, a personal operating system. You are given a reference document (a guide, handbook, or notes). Extract the concrete, actionable commitments a person should add to their system to actually put this document into practice.

The current date is ${now.isoDate} (${now.weekday}), timezone ${now.timezone}.

Classify each into exactly one type:
- HABIT: a recurring behaviour done on a schedule (e.g. "Eat 130g of protein daily", "Warm up before every workout", "Sleep 7.5-9 hours").
- GOAL: a measurable outcome or target to work toward (e.g. "Reach 70kg bodyweight", "Run 5km continuously", "Do 25 push-ups").
- TASK: a one-off action to complete once (e.g. "Buy a pair of dumbbells", "Book a blood test", "Buy running shoes").

<user_areas>
${areaNames.length ? areaNames.join(", ") : "None"}
</user_areas>

<rules>
1. Return at most ${MAX_ITEMS} items — the most impactful and repeatable ones. Do NOT try to capture everything; quality over quantity.
2. Write a clean, concise, imperative title (max 80 chars).
3. Put a one-sentence rationale in "detail".
4. Match each item to the most relevant user area by name in "suggestedAreaName", or null if none fits.
5. For HABIT set "frequency" (DAILY/WEEKLY/CUSTOM) and "targetMinutes" if a duration is implied.
6. For TASK/GOAL set "priority" (LOW/MEDIUM/HIGH). For TASK set "dueDate" (YYYY-MM-DD) ONLY if a concrete date is implied, else null. Resolve any relative timing ("within 2 weeks", "by next Monday", "in 30 days") against the current date above — dueDate must be an absolute date, never a relative phrase.
7. Set "sourceHeading" to the document section the item came from, if identifiable.
8. Respond with raw JSON only — no markdown code fences.
</rules>

<output_schema>
{
  "items": [
    {
      "itemType": "HABIT" | "GOAL" | "TASK",
      "title": "string",
      "detail": "string",
      "confidence": number,               // 0.0 - 1.0
      "suggestedAreaName": "string" | null,
      "frequency": "DAILY" | "WEEKLY" | "CUSTOM" | null,
      "targetMinutes": number | null,
      "priority": "LOW" | "MEDIUM" | "HIGH" | null,
      "dueDate": "YYYY-MM-DD" | null,
      "sourceHeading": "string" | null
    }
  ]
}
</output_schema>`

const clamp01 = (n: unknown): number => {
  const v = typeof n === "number" ? n : 0.7
  return Math.min(1, Math.max(0, v))
}

const parseItems = (rawJson: string): ExtractedItem[] => {
  const parsed = JSON.parse(rawJson) as { items?: unknown } | unknown[]
  const list = Array.isArray(parsed) ? parsed : (parsed.items as unknown[]) ?? []
  const items: ExtractedItem[] = []

  for (const entry of list) {
    const e = entry as Record<string, unknown>
    const itemType = String(e.itemType ?? "").toUpperCase() as ExtractItemType
    const title = typeof e.title === "string" ? e.title.trim() : ""
    if (!VALID_TYPES.includes(itemType) || !title) continue

    items.push({
      itemType,
      title: title.slice(0, 80),
      detail: typeof e.detail === "string" ? e.detail : undefined,
      confidence: clamp01(e.confidence),
      sourceHeading: typeof e.sourceHeading === "string" ? e.sourceHeading : undefined,
      suggestedAreaName:
        typeof e.suggestedAreaName === "string" ? e.suggestedAreaName : undefined,
      frequency:
        e.frequency === "DAILY" || e.frequency === "WEEKLY" || e.frequency === "CUSTOM"
          ? e.frequency
          : undefined,
      targetMinutes: typeof e.targetMinutes === "number" ? e.targetMinutes : undefined,
      priority:
        e.priority === "LOW" || e.priority === "MEDIUM" || e.priority === "HIGH"
          ? e.priority
          : undefined,
      dueDate: typeof e.dueDate === "string" ? e.dueDate : undefined,
    })
    if (items.length >= MAX_ITEMS) break
  }
  return items
}

const geminiExtract = async (text: string, areaNames: string[], now: RagNow): Promise<ExtractedItem[]> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")
  const model = geminiClient.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  })
  const result = await model.generateContent([
    { text: buildPrompt(areaNames, now) },
    { text: `Document:\n\n${text}` },
  ])
  return parseItems(result.response.text())
}

const groqExtract = async (text: string, areaNames: string[], now: RagNow): Promise<ExtractedItem[]> => {
  if (!groqClient) throw new Error("Groq client not initialized")
  const res = await groqClient.chat.completions.create({
    messages: [
      { role: "system", content: buildPrompt(areaNames, now) },
      { role: "user", content: `Document:\n\n${text}` },
    ],
    model: "openai/gpt-oss-120b",
    response_format: { type: "json_object" },
  })
  return parseItems(res.choices[0]?.message?.content || "{}")
}

// Extract actionable Habits/Goals/Tasks from a document (Gemini → Groq →
// empty). Extraction is meaningless without an LLM, so the heuristic just
// returns nothing rather than guessing.
export const extractActions = async (
  rawText: string,
  areas: { id: string; name: string }[],
  now: RagNow,
): Promise<ExtractedItem[]> => {
  const text = rawText.slice(0, MAX_TEXT)
  const areaNames = areas.map((a) => a.name)
  return runWithAiFallback(
    "Document action extraction",
    {
      gemini: geminiClient ? () => geminiExtract(text, areaNames, now) : undefined,
      groq: groqClient ? () => groqExtract(text, areaNames, now) : undefined,
    },
    () => {
      logger.info("Document extraction: no AI provider — returning no suggestions")
      return [] as ExtractedItem[]
    },
  )
}
