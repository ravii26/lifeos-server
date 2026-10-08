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

export type SavePurposeGuess = "LEARN" | "FEELING"

// One concrete step from a save. A repeatable step can become a habit.
export interface SaveAction {
  action: string
  minimum: string
  as: "TODO" | "HABIT"
  when: SaveWhen
}

export const FEELINGS = ["lazy", "low", "sad", "anxious", "stressed", "unmotivated", "stuck", "tired", "lonely", "angry"] as const

export interface SaveProposal {
  contentTitle: string
  kind: SaveKind
  // What the save is FOR: LEARN turns into actions, FEELING waits on the
  // shelf and comes back on that feeling. Ally guesses; one tap corrects it.
  purpose: SavePurposeGuess
  feelings: string[]
  // 1 to 3 steps; `action`, `minimum` and `when` below mirror the first one.
  actions: SaveAction[]
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
  // Set when the person corrected the guess: the proposal is redone for that purpose.
  forcePurpose?: SavePurposeGuess
}

const SYSTEM_PROMPT = `The user saved a piece of content (video, reel, post, article) in a life app. Most saved content is never acted on. Decide what it is FOR, then turn it into small concrete actions.

Rules:
- purpose: LEARN when it teaches a skill or gives something to try (how-to, tutorial, recipe, workout, interview prep). FEELING when it is there to lift or steady them on a hard day (motivation, speeches, quotes, "you can do it", comfort, calm). Guess from the caption and title. If unsure, LEARN. If "forcePurpose" is given, use exactly that.
- feelings: for FEELING only, 1 to 3 words for the moments it helps with, chosen from: lazy, low, sad, anxious, stressed, unmotivated, stuck, tired, lonely, angry. [] for LEARN.
- kind: LEARN (teaches a skill), DO (recipe, workout, task to try), MOTIVATION (inspiration; use for every FEELING save), ENTERTAINMENT (fun, no action), OTHER.
- actions: 1 to 3 concrete next steps, each under 30 minutes, each starting with a verb, most useful first. Not "watch the video" alone: add what to produce, e.g. "Watch it and write the 3 steps you'd use in an interview". For a FEELING save give at most 1 tiny action. Each action has: "action", "minimum" (its 2-minute version, e.g. "Watch the first 2 minutes"), "as" ("TODO" for a one-off, "HABIT" only for something worth repeating), "when" (TONIGHT if quick and it fits their main area, THIS_WEEK by default, LATER if it belongs to a LATER area or is not urgent).
- areaId: the id of the best matching area from the list, or null.
- reason: one short sentence on why this fits their goals.
- contentTitle: a short readable title of the saved content.

Return JSON only: {"contentTitle": string, "purpose": "LEARN"|"FEELING", "feelings": [string], "kind": string, "actions": [{"action": string, "minimum": string, "as": "TODO"|"HABIT", "when": string}], "areaId": string|null, "reason": string}`

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
    forcePurpose: input.forcePurpose ?? null,
  })

const KINDS: SaveKind[] = ["LEARN", "DO", "MOTIVATION", "ENTERTAINMENT", "OTHER"]
const WHENS: SaveWhen[] = ["TONIGHT", "THIS_WEEK", "LATER"]

interface Parsed {
  contentTitle?: unknown
  purpose?: unknown
  feelings?: unknown
  kind?: unknown
  actions?: unknown
  action?: unknown
  minimum?: unknown
  areaId?: unknown
  when?: unknown
  reason?: unknown
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")

export const cleanFeelings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((f) => String(f).toLowerCase().trim())
    .filter((f, i, all) => (FEELINGS as readonly string[]).includes(f) && all.indexOf(f) === i)
    .slice(0, 3)

// Never trust an enum or id from the model: unknown values fall back.
export const cleanActions = (v: unknown, max = 3): SaveAction[] =>
  (Array.isArray(v) ? v : [])
    .map((a) => {
      const o = a as { action?: unknown; minimum?: unknown; as?: unknown; when?: unknown }
      return {
        action: str(o?.action, 200),
        minimum: str(o?.minimum, 160) || "Just start. 2 minutes on it counts.",
        as: o?.as === "HABIT" ? ("HABIT" as const) : ("TODO" as const),
        when: WHENS.includes(o?.when as SaveWhen) ? (o!.when as SaveWhen) : ("THIS_WEEK" as SaveWhen),
      }
    })
    .filter((a) => a.action)
    .slice(0, max)

const finalize = (p: Parsed, input: SaveAiInput): SaveProposal => {
  const fallback = heuristicProposal(input)
  let actions = cleanActions(p.actions)
  if (!actions.length && str(p.action, 200)) actions = cleanActions([{ action: p.action, minimum: p.minimum, when: p.when }])
  const purpose: SavePurposeGuess = input.forcePurpose ?? (p.purpose === "FEELING" ? "FEELING" : "LEARN")
  if (!actions.length && purpose === "LEARN") throw new Error("Save AI returned no action")
  if (!actions.length) actions = fallback.actions
  const areaId = typeof p.areaId === "string" && input.areas.some((a) => a.id === p.areaId) ? p.areaId : fallback.areaId
  const feelings = purpose === "FEELING" ? (cleanFeelings(p.feelings).length ? cleanFeelings(p.feelings) : fallback.feelings) : []
  return {
    contentTitle: str(p.contentTitle, 160) || fallback.contentTitle,
    kind: purpose === "FEELING" ? "MOTIVATION" : KINDS.includes(p.kind as SaveKind) ? (p.kind as SaveKind) : fallback.kind,
    purpose,
    feelings,
    actions: purpose === "FEELING" ? actions.slice(0, 1) : actions,
    action: actions[0]!.action,
    minimum: actions[0]!.minimum,
    areaId,
    when: actions[0]!.when,
    reason: str(p.reason, 240) || fallback.reason,
    source: "ai",
  }
}

const MOTIVATION_WORDS = /motivat|inspir|discipline|mindset|never give up|hustle|success story|grind|nobody is coming|you can do it/i

export const heuristicProposal = (input: SaveAiInput): SaveProposal => {
  const main = input.areas.find((a) => a.tier === "MAIN") ?? input.areas[0] ?? null
  const contentTitle = input.link?.title ?? (input.text.replace(URL_RE, "").trim().slice(0, 120) || "Your save")
  const feeling = input.forcePurpose ? input.forcePurpose === "FEELING" : MOTIVATION_WORDS.test(`${contentTitle} ${input.text}`)
  const kind: SaveKind = feeling ? "MOTIVATION" : "LEARN"
  const action: SaveAction = {
    action: feeling ? "Watch it, then do one 5-minute step toward your main goal" : "Watch it for 10 minutes and write down 3 things you'll use",
    minimum: "Watch the first 2 minutes",
    as: "TODO",
    when: "THIS_WEEK",
  }
  return {
    contentTitle,
    kind,
    purpose: feeling ? "FEELING" : "LEARN",
    feelings: feeling ? ["unmotivated"] : [],
    actions: [action],
    action: action.action,
    minimum: action.minimum,
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

// ---- reading a YouTube video (Gemini watches public videos by link) -------------

export interface VideoRead {
  title: string | null
  lines: string[] // 3 to 5 short lines, each one idea
  purpose: SavePurposeGuess
  feelings: string[]
  actions: SaveAction[]
}

const VIDEO_PROMPT = `Watch this video the person saved in a life app. Return JSON only:
{"contentTitle": string, "summary": [3 to 5 short lines], "purpose": "LEARN"|"FEELING", "feelings": [string], "actions": [{"action": string, "minimum": string, "as": "TODO"|"HABIT", "when": "TONIGHT"|"THIS_WEEK"|"LATER"}]}
Rules:
- summary: plain words, one idea per line, at most 18 words each, things they could use. Only what is actually in the video; never invent.
- purpose: LEARN if it teaches or shows something to try; FEELING if it is there to lift or steady someone on a hard day.
- feelings: for FEELING only, 1 to 3 from: ${FEELINGS.join(", ")}. [] for LEARN.
- actions: 1 to 3 concrete steps under 30 minutes, each starting with a verb and naming what to produce. For FEELING at most 1 tiny action. "minimum" is the 2-minute version. "as" is HABIT only for something worth repeating.`

const VIDEO_TIMEOUT_MS = 90_000

export const watchVideo = async (url: string, areas: SaveAreaOption[], yearGoal: string | null): Promise<VideoRead | null> => {
  if (!geminiClient) return null
  try {
    const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json" } })
    const call = model.generateContent([
      { fileData: { mimeType: "video/mp4", fileUri: url } } as never,
      { text: `${VIDEO_PROMPT}\n\nTheir year goal: ${yearGoal ?? "not set"}. Their areas: ${areas.map((a) => `${a.name} (${a.tier})`).join(", ") || "none yet"}.` },
    ])
    const result = await Promise.race([
      call,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("video read timed out")), VIDEO_TIMEOUT_MS)),
    ])
    const p = JSON.parse(result.response.text()) as { contentTitle?: unknown; summary?: unknown; purpose?: unknown; feelings?: unknown; actions?: unknown }
    const lines = (Array.isArray(p.summary) ? p.summary : []).map((l) => str(l, 160)).filter(Boolean).slice(0, 5)
    if (lines.length < 2) return null
    const purpose: SavePurposeGuess = p.purpose === "FEELING" ? "FEELING" : "LEARN"
    const actions = cleanActions(p.actions)
    if (!actions.length) return null
    return {
      title: str(p.contentTitle, 160) || null,
      lines,
      purpose,
      feelings: purpose === "FEELING" ? cleanFeelings(p.feelings) : [],
      actions: purpose === "FEELING" ? actions.slice(0, 1) : actions,
    }
  } catch (err) {
    logger.info(`Video read skipped for ${url}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
