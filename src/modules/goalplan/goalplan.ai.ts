/* =====================================================================
   The one place the AI plans (plan 16 §1, Layer 1): a goal in the
   person's words → weekly targets, using general knowledge. The answer
   is only a proposal; goalplan.rules.ts cleans and fits it, and the
   person keeps or changes it.
   ===================================================================== */
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import logger from "../../lib/logger.js"

export interface GoalPlanContext {
  todayKey: string
  weekday: string
  weeklyFreeMinutes: number
  freeByBlock: string // "MORNING ~2 h on weekdays, EVENING ~1.5 h, weekends ~6 h"
  otherTargets: string[] // "Guitar 3 h/week"
  areas: string[]
}

const PROMPT = (c: GoalPlanContext) => `You plan goals for Ally, a personal assistant. Turn the person's goal into a weekly plan they can actually keep.
Return JSON only:
{"title": string, "why": string|null, "deadline": "YYYY-MM-DD"|null, "targets": [{"title": string, "unit": "min"|"count", "perWeek": number, "countUnit": string|null, "sessionMinutes": number|null, "block": "MORNING"|"COMMUTE"|"EVENING"|"NIGHT"|"GYM"|null, "note": string}], "milestones": [string], "question": string|null}
Rules:
- 1 to 5 targets. Each is something done every week: "min" = minutes per week (practice, study), "count" = things per week (applications, calls, mock interviews) with countUnit plural ("applications").
- Use general knowledge of how this kind of goal is done well (e.g. exam prep: daily problem practice, weekly mock tests near the end; fitness: 3-4 sessions a week; a new language: short daily sessions plus one weekly conversation; saving money: a weekly amount and one weekly check). Fit the plan to THEIR goal and field, never a default one. Short daily sessions beat one long weekly one.
- sessionMinutes: one sitting, 15 to 90. block: when it fits best given their free time below. Never during their work or study hours.
- The whole plan must fit their free time: about ${Math.round(c.weeklyFreeMinutes / 60)} h a week free (${c.freeByBlock}), minus their other targets (${c.otherTargets.join("; ") || "none"}). Leave room to rest.
- deadline: only if they said one or a time span ("in 2 months" from today ${c.todayKey}, ${c.weekday}). If they gave a date or span, never ask when. If a deadline matters and they gave none, set "question" to one short question about this goal only asking when, and still propose targets.
- milestones: 0 to 5 checkpoints in order, only if the goal has natural stages.
- note: one short line on how to spread it ("≈ 50 min most mornings").
- Use their words for titles; keep titles short ("Practice problems", "Applications"). Never invent facts about them.
Their areas: ${c.areas.join(", ") || "none yet"}.`

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    return m ? JSON.parse(m[0]) : null
  }
}

export const proposePlanAi = async (goalText: string, c: GoalPlanContext): Promise<unknown | null> =>
  runWithAiFallback<unknown | null>(
    "Goal plan",
    {
      gemini: geminiClient
        ? async () => {
            const model = geminiClient!.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json" } })
            const r = await model.generateContent([{ text: PROMPT(c) }, { text: `Their goal, in their words:\n${goalText.slice(0, 2000)}` }])
            return parse(r.response.text())
          }
        : undefined,
      groq: groqClient
        ? async () => {
            const r = await groqClient!.chat.completions.create({
              model: "openai/gpt-oss-120b",
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: PROMPT(c) },
                { role: "user", content: `Their goal, in their words:\n${goalText.slice(0, 2000)}` },
              ],
            })
            return parse(r.choices[0]?.message?.content || "{}")
          }
        : undefined,
    },
    () => {
      // Planning a goal needs general knowledge; without AI, say so instead of guessing.
      logger.info("Goal plan: no AI available")
      return null
    },
  )
