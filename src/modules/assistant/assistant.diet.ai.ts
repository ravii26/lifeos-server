/* =====================================================================
   "Shopping list from my diet" (ADR 0040): the one AI call in the diet
   slice, made only when the person asks for it. It turns the week's meal
   names into plain ingredient names. Rules still decide what happens next:
   the answer is validated here and added to the list by code.
   ===================================================================== */
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { itemsFromMealNames } from "../allynote/diet.rules.js"

const MAX_ITEMS = 30

const prompt = (meals: string[]): string =>
  `You turn a person's weekly meals into a shopping list of ingredients to buy.
Meals (one per line):
${meals.map((m) => `- ${m}`).join("\n")}

Reply with JSON only: {"items": ["Oats", "Eggs", ...]}.
Rules: plain ingredient names, singular or common form, no quantities, no brands, no duplicates, at most ${MAX_ITEMS}.
Skip water and things nobody buys. If a meal is already one ingredient (like "oats"), keep it.`

// Every item is checked: a short string, no repeats, capped.
export const parseIngredients = (raw: string): string[] => {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const list = (data as { items?: unknown })?.items
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of list) {
    if (typeof v !== "string") continue
    const t = v.replace(/\s+/g, " ").trim()
    const key = t.toLowerCase()
    if (t.length < 2 || t.length > 40 || seen.has(key)) continue
    seen.add(key)
    out.push(t.charAt(0).toUpperCase() + t.slice(1))
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

export interface IngredientResult {
  items: string[]
  fromAi: boolean
}

export const ingredientsFromMeals = async (meals: string[]): Promise<IngredientResult> => {
  const p = prompt(meals.slice(0, 40))
  return runWithAiFallback<IngredientResult>(
    "Shopping from diet",
    {
      gemini: geminiClient
        ? async () => {
            const model = geminiClient!.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json" } })
            const res = await model.generateContent([{ text: p }])
            const items = parseIngredients(res.response.text())
            if (!items.length) throw new Error("no ingredients")
            return { items, fromAi: true }
          }
        : undefined,
      groq: groqClient
        ? async () => {
            const res = await groqClient!.chat.completions.create({
              messages: [{ role: "user", content: p }],
              model: "openai/gpt-oss-120b",
              response_format: { type: "json_object" },
            })
            const items = parseIngredients(res.choices[0]?.message?.content || "{}")
            if (!items.length) throw new Error("no ingredients")
            return { items, fromAi: true }
          }
        : undefined,
    },
    () => ({ items: itemsFromMealNames(meals), fromAi: false }),
  )
}
