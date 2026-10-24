/* =====================================================================
   Sharing many at once (Phase D slice D7, ADR 0044): "Share 10 → 3 matter
   for your goals; the rest go to Watch later." One AI call looks at all of
   them together (titles only, so it stays cheap) and says which fit the
   person's goals and what kind each is. Nothing is acted on: the saves wait
   for a decision, and "put the rest in watch later" is one more tap.
   ===================================================================== */
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { cleanContentType, cleanDomain, type ContentType, type Domain } from "./saves.type.rules.js"

export const MAX_BATCH = 10

export interface BatchItem {
  n: number
  title: string
  platform: string | null
  text: string
}

export interface Triage {
  n: number
  matters: boolean
  contentType: ContentType | null
  domain: Domain
  lengthMinutes: number | null
}

const prompt = (items: BatchItem[], goal: string | null, areas: string[]): string =>
  `The person shared several saves at once in a life app. For each, say whether it clearly matters for their goals right now, what kind of content it is, and roughly how long it is.
Their year goal: ${goal ?? "not set"}. Their areas: ${areas.join(", ") || "none yet"}.
Saves:
${items.map((i) => `${i.n}. ${i.title}${i.platform ? ` (${i.platform})` : ""}${i.text && i.text !== i.title ? ` - ${i.text.slice(0, 160)}` : ""}`).join("\n")}

Reply with JSON only: {"items":[{"n":number,"matters":boolean,"contentType":"WORKOUT"|"RECIPE"|"TUTORIAL"|"COURSE"|"BOOK"|"MOTIVATION"|"RECOMMENDATION"|"PLACE"|"MONEY"|"PRODUCT"|"NEWS"|"FUN","domain":"career"|"coding"|"fitness"|"food"|"money"|"mindset"|"relationships"|"travel"|"fun"|"learning"|"other","lengthMinutes":number|null}]}.
"matters" is true only when it clearly fits the year goal or a main area. When unsure, false. One entry per save.`

// Checked field by field: unknown numbers and values are dropped.
export const parseTriage = (raw: string, count: number): Triage[] => {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const list = (data as { items?: unknown })?.items
  if (!Array.isArray(list)) return []
  const out = new Map<number, Triage>()
  for (const v of list) {
    const o = v as { n?: unknown; matters?: unknown; contentType?: unknown; domain?: unknown; lengthMinutes?: unknown }
    const n = Number(o?.n)
    if (!Number.isInteger(n) || n < 1 || n > count || out.has(n)) continue
    const len = typeof o.lengthMinutes === "number" && Number.isFinite(o.lengthMinutes) ? Math.min(600, Math.max(1, Math.round(o.lengthMinutes))) : null
    out.set(n, { n, matters: o.matters === true, contentType: cleanContentType(o.contentType), domain: cleanDomain(o.domain), lengthMinutes: len })
  }
  return [...out.values()]
}

const words = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4))

// Without an AI: a save matters when its title shares a real word with the goal or an area.
export const heuristicTriage = (items: BatchItem[], goal: string | null, areas: string[]): Triage[] => {
  const mine = words(`${goal ?? ""} ${areas.join(" ")}`)
  return items.map((i) => ({
    n: i.n,
    matters: [...words(`${i.title} ${i.text}`)].some((w) => mine.has(w)),
    contentType: null,
    domain: "other" as Domain,
    lengthMinutes: null,
  }))
}

export const triageSaves = async (items: BatchItem[], goal: string | null, areas: string[]): Promise<Triage[]> => {
  const p = prompt(items, goal, areas)
  const check = (raw: string): Triage[] => {
    const t = parseTriage(raw, items.length)
    if (t.length < Math.ceil(items.length / 2)) throw new Error("triage incomplete")
    return t
  }
  return runWithAiFallback<Triage[]>(
    "Save triage",
    {
      gemini: geminiClient
        ? async () => {
            const model = geminiClient!.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json" } })
            return check((await model.generateContent([{ text: p }])).response.text())
          }
        : undefined,
      groq: groqClient
        ? async () => {
            const res = await groqClient!.chat.completions.create({ messages: [{ role: "user", content: p }], model: "openai/gpt-oss-120b", response_format: { type: "json_object" } })
            return check(res.choices[0]?.message?.content || "{}")
          }
        : undefined,
    },
    () => heuristicTriage(items, goal, areas),
  )
}
