import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import type { RagNow } from "../../lib/rag.js"
import logger from "../../lib/logger.js"

// Mirrors the web client's fixed Area icon/color set exactly
// (lifeos-client/src/features/areas/constants.tsx) so an AI-proposed Area
// renders correctly instead of falling back to a generic icon for an
// icon name the picker doesn't recognize. If that palette ever changes,
// update both places — there's no shared source of truth across repos.
export const AREA_ICON_NAMES = [
  "briefcase",
  "heart",
  "dumbbell",
  "wallet",
  "brain",
  "users",
  "palette",
  "sparkles",
] as const

export const AREA_COLORS = [
  "#1a56ff",
  "#00a651",
  "#7b2ff7",
  "#d6a200",
  "#ff2f6e",
  "#ffb400",
] as const

export interface OnboardingArea {
  name: string
  type: "PRIMARY" | "MAINTENANCE"
  icon: (typeof AREA_ICON_NAMES)[number]
  color: (typeof AREA_COLORS)[number]
}

export type OnboardingActionType = "GOAL" | "HABIT" | "TASK"

export interface OnboardingAction {
  itemType: OnboardingActionType
  title: string
  detail?: string
  areaName: string
  frequency?: "DAILY" | "WEEKLY" | "CUSTOM"
  targetMinutes?: number
  priority?: "LOW" | "MEDIUM" | "HIGH"
  dueDate?: string
  // For a TASK: ON that day or BY it, and hours of the day ("HH:MM"). Checked by the caller.
  dueKind?: string
  windowFrom?: string
  windowTo?: string
  // Where it came from: the user's exact words for it, or (suggested) what
  // of theirs the model's own idea is for. Checked against the text by the caller.
  said?: string
  suggested?: boolean
  for?: string
}

export interface OnboardingExtraction {
  areas: OnboardingArea[]
  actions: OnboardingAction[]
}

const MAX_AREAS = 5
const MAX_ACTIONS = 12
const MAX_TEXT = 4_000
const VALID_ACTION_TYPES: OnboardingActionType[] = ["GOAL", "HABIT", "TASK"]

const buildPrompt = (existingAreaNames: string[], now: RagNow): string => `You are the onboarding agent of Ally, a personal assistant app. A brand-new user just wrote a few sentences about their life, what they care about, and what they want to work on. Turn that into a starter setup: a small set of life Areas, and a handful of Goals/Habits/Tasks under them.

The current date is ${now.isoDate} (${now.weekday}), timezone ${now.timezone}.

<existing_areas>
${existingAreaNames.length ? existingAreaNames.join(", ") : "None — this user has no areas yet"}
</existing_areas>

<rules>
1. Propose at most ${MAX_AREAS} Areas that cover the distinct life domains the user actually mentioned (e.g. "Health", "Career", "Relationships") — do not invent domains they didn't imply. If they only talked about one thing, one Area is fine; don't pad to reach a count.
2. If the user's text implies something covered by an EXISTING area (see above), reuse that exact area name instead of proposing a near-duplicate.
3. For each proposed Area set "type" to PRIMARY (something they're actively pursuing) or MAINTENANCE (something to just keep steady), "icon" to exactly one of: ${AREA_ICON_NAMES.join(", ")}, and "color" to exactly one of: ${AREA_COLORS.join(", ")} — pick a different color per area where possible, and pick the icon that best fits the area's theme (e.g. dumbbell for fitness, briefcase for career, heart for relationships/wellbeing, wallet for finance, brain for learning/mind, users for relationships/social, sparkles for creative, palette for hobbies/creative).
4. Propose at most ${MAX_ACTIONS} total Goals/Habits/Tasks, split across the areas above (or existing areas) — quality over quantity, these are STARTER items, not an exhaustive plan.
5. Classify each into exactly one type:
   - GOAL: a measurable outcome or target (e.g. "Run a 10k under 50 minutes").
   - HABIT: a recurring behaviour on a schedule (e.g. "Stretch every morning") — set "frequency" (DAILY/WEEKLY/CUSTOM) and "targetMinutes" if implied.
   - TASK: a concrete one-off action to do soon (e.g. "Book a gym trial") — set "priority" (LOW/MEDIUM/HIGH); set "dueDate" (YYYY-MM-DD, absolute) only if the user named a day or date, else null; set "dueKind" to ON if it happens on that day ("tomorrow", "on Saturday") or BY if the day is a deadline ("by Friday", "before the 20th"); set "windowFrom"/"windowTo" (24h HH:MM) only if the user gave hours or a part of the day ("run 6 to 8 am" = 06:00 and 08:00; morning = 06:00-09:00, afternoon = 12:00-16:00, evening = 18:00-21:00, night = 21:00-23:00), else null.
6. Every Goal/Habit/Task's "areaName" must exactly match one of the Area names you proposed (or an existing area name from the list above) — never invent an area name in an action that isn't also a proposed/existing Area.
7. Titles stay close to the user's OWN words (max 80 chars): tidy them, do not rephrase a wish into a different task. "reduce my scrolling" stays "Reduce scrolling", never "Draft a personal weekly schedule to reduce scrolling". Leave the day or time out of the title.
7a. For every item set "said" to the user's exact words it came from (copied from their text) and "suggested" to false.
7b. You may add at most 3 ideas of your own in total: a small first step towards something they said. For each, set "suggested" to true, "for" to the few words of theirs it is for (copied from their text), and "detail" to one plain sentence saying why it helps. Never present your own idea as something they said.
7c. "detail" is a one-sentence rationale.
8. If the user's text is too vague or short to say anything concrete, return fewer items rather than inventing generic ones ("exercise more", "be productive") — a short, honest starter beats a padded generic one.
9. Respond with raw JSON only — no markdown code fences.
</rules>

<output_schema>
{
  "areas": [
    { "name": "string", "type": "PRIMARY" | "MAINTENANCE", "icon": "string", "color": "string" }
  ],
  "actions": [
    {
      "itemType": "GOAL" | "HABIT" | "TASK",
      "title": "string",
      "detail": "string",
      "areaName": "string",
      "frequency": "DAILY" | "WEEKLY" | "CUSTOM" | null,
      "targetMinutes": number | null,
      "priority": "LOW" | "MEDIUM" | "HIGH" | null,
      "dueDate": "YYYY-MM-DD" | null,
      "dueKind": "ON" | "BY" | null,
      "windowFrom": "HH:MM" | null,
      "windowTo": "HH:MM" | null,
      "said": "string" | null,
      "suggested": true | false,
      "for": "string" | null
    }
  ]
}
</output_schema>`

const isIconName = (v: unknown): v is (typeof AREA_ICON_NAMES)[number] =>
  typeof v === "string" && (AREA_ICON_NAMES as readonly string[]).includes(v)

const isAreaColor = (v: unknown): v is (typeof AREA_COLORS)[number] =>
  typeof v === "string" && (AREA_COLORS as readonly string[]).includes(v)

const parseExtraction = (rawJson: string): OnboardingExtraction => {
  const parsed = JSON.parse(rawJson) as { areas?: unknown; actions?: unknown }

  const rawAreas = Array.isArray(parsed.areas) ? parsed.areas : []
  const areas: OnboardingArea[] = []
  for (const entry of rawAreas) {
    const e = entry as Record<string, unknown>
    const name = typeof e.name === "string" ? e.name.trim() : ""
    if (!name) continue
    areas.push({
      name: name.slice(0, 100),
      type: e.type === "MAINTENANCE" ? "MAINTENANCE" : "PRIMARY",
      // Fall back to a deterministic pick rather than dropping the area if
      // the model ever returns an icon/color outside the fixed set.
      icon: isIconName(e.icon) ? e.icon : AREA_ICON_NAMES[areas.length % AREA_ICON_NAMES.length],
      color: isAreaColor(e.color) ? e.color : AREA_COLORS[areas.length % AREA_COLORS.length],
    })
    if (areas.length >= MAX_AREAS) break
  }

  const areaNames = new Set(areas.map((a) => a.name))
  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : []
  const actions: OnboardingAction[] = []
  for (const entry of rawActions) {
    const e = entry as Record<string, unknown>
    const itemType = String(e.itemType ?? "").toUpperCase() as OnboardingActionType
    const title = typeof e.title === "string" ? e.title.trim() : ""
    const areaName = typeof e.areaName === "string" ? e.areaName.trim() : ""
    // Drop anything that doesn't resolve to a real proposed area — better to
    // lose one item than to hand the client an orphan it can't create.
    if (!VALID_ACTION_TYPES.includes(itemType) || !title || !areaNames.has(areaName)) continue

    actions.push({
      itemType,
      title: title.slice(0, 80),
      detail: typeof e.detail === "string" ? e.detail : undefined,
      areaName,
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
      dueKind: typeof e.dueKind === "string" ? e.dueKind : undefined,
      windowFrom: typeof e.windowFrom === "string" ? e.windowFrom : undefined,
      windowTo: typeof e.windowTo === "string" ? e.windowTo : undefined,
      said: typeof e.said === "string" ? e.said : undefined,
      suggested: e.suggested === true,
      for: typeof e.for === "string" ? e.for : undefined,
    })
    if (actions.length >= MAX_ACTIONS) break
  }

  return { areas, actions }
}

const geminiExtract = async (text: string, existing: string[], now: RagNow): Promise<OnboardingExtraction> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")
  const model = geminiClient.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  })
  const result = await model.generateContent([
    { text: buildPrompt(existing, now) },
    { text: `User's own words:\n\n${text}` },
  ])
  return parseExtraction(result.response.text())
}

const groqExtract = async (text: string, existing: string[], now: RagNow): Promise<OnboardingExtraction> => {
  if (!groqClient) throw new Error("Groq client not initialized")
  const res = await groqClient.chat.completions.create({
    messages: [
      { role: "system", content: buildPrompt(existing, now) },
      { role: "user", content: `User's own words:\n\n${text}` },
    ],
    model: "openai/gpt-oss-120b",
    response_format: { type: "json_object" },
  })
  return parseExtraction(res.choices[0]?.message?.content || "{}")
}

// Turn a free-text "tell me about your life" blurb into a proposed starter
// setup (Gemini → Groq → empty). Meaningless without an LLM — the heuristic
// returns nothing rather than guessing generic areas/goals for someone.
export const extractOnboardingSetup = async (
  rawText: string,
  existingAreaNames: string[],
  now: RagNow,
): Promise<OnboardingExtraction> => {
  const text = rawText.slice(0, MAX_TEXT)
  return runWithAiFallback(
    "Onboarding setup extraction",
    {
      gemini: geminiClient ? () => geminiExtract(text, existingAreaNames, now) : undefined,
      groq: groqClient ? () => groqExtract(text, existingAreaNames, now) : undefined,
    },
    () => {
      logger.info("Onboarding extraction: no AI provider — returning nothing")
      return { areas: [], actions: [] } as OnboardingExtraction
    },
  )
}
