import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import logger from "../../lib/logger.js"

// Saved content → one action. A save is only worth keeping if it turns into
// something the person will do (or comfort for a hard day); everything else
// is collecting.

export type SaveKind = "LEARN" | "DO" | "MOTIVATION" | "ENTERTAINMENT" | "OTHER"
export type SaveWhen = "TONIGHT" | "THIS_WEEK" | "LATER"

export interface LinkInfo {
  url: string
  title: string | null
  author: string | null
  platform: string | null
}

export interface SaveAreaOption {
  id: string
  name: string
  tier: string
}

export interface SaveProposal {
  contentTitle: string
  kind: SaveKind
  action: string
  minimum: string
  areaId: string | null
  when: SaveWhen
  reason: string
  source: "ai" | "heuristic"
}

const URL_RE = /https?:\/\/[^\s<>"']+/i

export const extractUrl = (text: string): string | null => text.match(URL_RE)?.[0] ?? null

export const platformOf = (url: string): string | null => {
  if (/youtube\.com|youtu\.be/i.test(url)) return "YouTube"
  if (/instagram\.com/i.test(url)) return "Instagram"
  if (/linkedin\.com/i.test(url)) return "LinkedIn"
  if (/twitter\.com|x\.com/i.test(url)) return "X"
  if (/medium\.com/i.test(url)) return "Medium"
  return null
}

const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Ally/1.0 (+link preview)" } })
  } finally {
    clearTimeout(timer)
  }
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")

// Best-effort title lookup. YouTube has a public oEmbed endpoint; other pages
// get their og:title / <title>. Instagram hides both without a login, so its
// saves rely on the person's caption or a screenshot instead.
export const readLink = async (url: string): Promise<LinkInfo> => {
  const platform = platformOf(url)
  const info: LinkInfo = { url, title: null, author: null, platform }
  try {
    if (platform === "YouTube") {
      const res = await fetchWithTimeout(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
        4000,
      )
      if (res.ok) {
        const j = (await res.json()) as { title?: string; author_name?: string }
        info.title = j.title ?? null
        info.author = j.author_name ?? null
      }
      return info
    }
    if (platform === "Instagram") return info
    const res = await fetchWithTimeout(url, 4000)
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return info
    const html = (await res.text()).slice(0, 200_000)
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    const title = og ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
    info.title = title ? decodeEntities(title.trim()).slice(0, 200) : null
  } catch (err) {
    logger.info(`Link preview skipped for ${url}: ${err instanceof Error ? err.message : String(err)}`)
  }
  return info
}

export interface SaveAiInput {
  text: string // caption, pasted text, or screenshot description
  link: LinkInfo | null
  areas: SaveAreaOption[]
  yearGoal: string | null
}

const SYSTEM_PROMPT = `The user saved a piece of content (video, reel, post, article) in a life app. Most saved content is never acted on. Your job: turn it into ONE small, concrete action they could do, linked to one of their life areas.

Rules:
- kind: LEARN (teaches a skill), DO (recipe, workout, task to try), MOTIVATION (inspiration, speeches, "you can do it" content), ENTERTAINMENT (fun, no action), OTHER.
- action: one concrete step under 30 minutes, starting with a verb. Not "watch the video" alone: add what to produce, e.g. "Watch it and write the 3 steps you'd use in an interview".
- minimum: the 2-minute version, e.g. "Watch the first 2 minutes".
- areaId: the id of the best matching area from the list, or null.
- when: TONIGHT if it is quick and fits their main area, THIS_WEEK by default, LATER if it belongs to a LATER area or is not urgent.
- reason: one short sentence on why this action fits their goals.
- contentTitle: a short readable title of the saved content.
For MOTIVATION or ENTERTAINMENT content still suggest an action, but keep it tiny.

Return JSON only: {"contentTitle": string, "kind": string, "action": string, "minimum": string, "areaId": string|null, "when": string, "reason": string}`

const toPrompt = (input: SaveAiInput) =>
  JSON.stringify({
    saved: {
      text: input.text.slice(0, 2000),
      url: input.link?.url ?? null,
      title: input.link?.title ?? null,
      author: input.link?.author ?? null,
      platform: input.link?.platform ?? null,
    },
    yearGoal: input.yearGoal,
    areas: input.areas,
  })

const KINDS: SaveKind[] = ["LEARN", "DO", "MOTIVATION", "ENTERTAINMENT", "OTHER"]
const WHENS: SaveWhen[] = ["TONIGHT", "THIS_WEEK", "LATER"]

interface Parsed {
  contentTitle?: unknown
  kind?: unknown
  action?: unknown
  minimum?: unknown
  areaId?: unknown
  when?: unknown
  reason?: unknown
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")

// Never trust an area id or enum from the model: unknown values fall back.
const finalize = (p: Parsed, input: SaveAiInput): SaveProposal => {
  const action = str(p.action, 200)
  if (!action) throw new Error("Save AI returned no action")
  const fallback = heuristicProposal(input)
  const areaId = typeof p.areaId === "string" && input.areas.some((a) => a.id === p.areaId) ? p.areaId : fallback.areaId
  return {
    contentTitle: str(p.contentTitle, 160) || fallback.contentTitle,
    kind: KINDS.includes(p.kind as SaveKind) ? (p.kind as SaveKind) : fallback.kind,
    action,
    minimum: str(p.minimum, 160) || fallback.minimum,
    areaId,
    when: WHENS.includes(p.when as SaveWhen) ? (p.when as SaveWhen) : "THIS_WEEK",
    reason: str(p.reason, 240) || fallback.reason,
    source: "ai",
  }
}

const MOTIVATION_WORDS = /motivat|inspir|discipline|mindset|never give up|hustle|success story|grind/i

export const heuristicProposal = (input: SaveAiInput): SaveProposal => {
  const main = input.areas.find((a) => a.tier === "MAIN") ?? input.areas[0] ?? null
  const contentTitle = input.link?.title ?? (input.text.replace(URL_RE, "").trim().slice(0, 120) || "Your save")
  const kind: SaveKind = MOTIVATION_WORDS.test(`${contentTitle} ${input.text}`) ? "MOTIVATION" : "LEARN"
  return {
    contentTitle,
    kind,
    action:
      kind === "MOTIVATION"
        ? "Watch it, then do one 5-minute step toward your main goal"
        : "Watch it for 10 minutes and write down 3 things you'll use",
    minimum: "Watch the first 2 minutes",
    areaId: main?.id ?? null,
    when: "THIS_WEEK",
    reason: main ? `It fits ${main.name}, your ${main.tier.toLowerCase()} focus.` : "A small step beats another save.",
    source: "heuristic",
  }
}

const viaGemini = async (input: SaveAiInput): Promise<SaveProposal> => {
  if (!geminiClient) throw new Error("Gemini client not initialized")
  const model = geminiClient.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  })
  const result = await model.generateContent([{ text: SYSTEM_PROMPT }, { text: toPrompt(input) }])
  return finalize(JSON.parse(result.response.text()) as Parsed, input)
}

const viaGroq = async (input: SaveAiInput): Promise<SaveProposal> => {
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

export const proposeAction = (input: SaveAiInput): Promise<SaveProposal> =>
  runWithAiFallback(
    "Save to action",
    {
      gemini: geminiClient ? () => viaGemini(input) : undefined,
      groq: groqClient ? () => viaGroq(input) : undefined,
    },
    () => heuristicProposal(input),
  )
