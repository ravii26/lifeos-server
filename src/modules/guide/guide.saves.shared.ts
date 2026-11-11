/* =====================================================================
   The shared content brain (ADR 0046). A public video is watched once; what
   it says (title, summary, purpose, type) is stored by its video id and
   reused for everyone who saves it later. Only the suggested steps are made
   per person, from the stored summary, with a small text request instead
   of watching the video again.

   Nothing personal is shared: the stored read holds the content only, never
   who saved it, their goals or their steps.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import logger from "../../lib/logger.js"
import { cleanActions, watchVideo, type SaveAction, type SaveAreaOption, type VideoRead } from "./guide.saves.ai.js"

const YT_ID = /^[A-Za-z0-9_-]{11}$/

// "yt:<id>" for any form of YouTube link, null for anything else.
export const videoKey = (url: string): string | null => {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(?:www\.|m\.|music\.)/, "")
  let id: string | null = null
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v")
    if (!id) {
      const [, kind, rest] = u.pathname.split("/")
      if (kind && ["shorts", "embed", "live", "v"].includes(kind)) id = rest ?? null
    }
  }
  return id && YT_ID.test(id) ? `yt:${id}` : null
}

const STEPS_PROMPT = `Someone saved a video. From its summary below, suggest what they could do with it. Return JSON only:
{"actions": [{"action": string, "minimum": string, "as": "TODO"|"HABIT", "when": "TONIGHT"|"THIS_WEEK"|"LATER"}]}
- 1 to 3 concrete steps under 30 minutes, each starting with a verb and naming what to produce. For a video meant to lift someone on a hard day, at most 1 tiny step.
- "minimum" is the 2-minute version. "as" is HABIT only for something worth repeating.
- Fit the steps to their year goal and areas when the video relates to them; never invent anything the summary does not support.`

const stepsInput = (read: Pick<VideoRead, "title" | "lines" | "purpose">, areas: SaveAreaOption[], yearGoal: string | null) =>
  [
    `Video: ${read.title ?? "untitled"} (${read.purpose === "FEELING" ? "to lift them on a hard day" : "to learn from"})`,
    `Summary:\n${read.lines.map((l) => `- ${l}`).join("\n")}`,
    `Their year goal: ${yearGoal ?? "not set"}. Their areas: ${areas.map((a) => `${a.name} (${a.tier})`).join(", ") || "none yet"}.`,
  ].join("\n\n")

// Steps for one person, from a stored summary. A small text request; null if it fails.
const stepsFor = (read: Pick<VideoRead, "title" | "lines" | "purpose">, areas: SaveAreaOption[], yearGoal: string | null): Promise<SaveAction[] | null> => {
  const input = stepsInput(read, areas, yearGoal)
  const parse = (raw: string | null | undefined) => {
    const actions = cleanActions((JSON.parse(raw || "{}") as { actions?: unknown }).actions)
    if (!actions.length) throw new Error("no usable steps")
    return read.purpose === "FEELING" ? actions.slice(0, 1) : actions
  }
  return runWithAiFallback<SaveAction[] | null>(
    "Save video steps",
    {
      groq: groqClient
        ? async () => {
            const res = await groqClient!.chat.completions.create({
              messages: [
                { role: "system", content: STEPS_PROMPT },
                { role: "user", content: input },
              ],
              model: "openai/gpt-oss-120b",
              response_format: { type: "json_object" },
              max_tokens: 500,
            })
            return parse(res.choices[0]?.message?.content)
          }
        : undefined,
      gemini: geminiClient
        ? async () => {
            const model = geminiClient!.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json", maxOutputTokens: 500 } })
            return parse((await model.generateContent([{ text: STEPS_PROMPT }, { text: input }])).response.text())
          }
        : undefined,
    },
    () => null,
  )
}

// What a video says, for this person. A video someone already saved is not
// watched again: its stored read is reused and only the steps are made fresh.
export const readVideo = async (url: string, areas: SaveAreaOption[], yearGoal: string | null): Promise<VideoRead | null> => {
  const key = videoKey(url)
  if (key) {
    const stored = await prisma.contentRead.findUnique({ where: { key } }).catch(() => null)
    if (stored && stored.lines.length >= 2) {
      const purpose = stored.purpose === "FEELING" ? "FEELING" : "LEARN"
      const actions = await stepsFor({ title: stored.title, lines: stored.lines, purpose }, areas, yearGoal).catch(() => null)
      if (actions) {
        void prisma.contentRead.update({ where: { key }, data: { reused: { increment: 1 } } }).catch(() => undefined)
        return {
          title: stored.title,
          lines: stored.lines,
          purpose,
          feelings: purpose === "FEELING" ? stored.feelings : [],
          actions,
          contentType: stored.contentType ?? undefined,
          domain: stored.domain ?? undefined,
          lengthMinutes: stored.lengthMinutes,
        }
      }
      // Could not make steps without AI: watch it the normal way below.
    }
  }

  const read = await watchVideo(url, areas, yearGoal)
  if (read && key) {
    const content = {
      title: read.title,
      lines: read.lines,
      purpose: read.purpose,
      feelings: read.feelings,
      contentType: typeof read.contentType === "string" ? read.contentType.slice(0, 40) : null,
      domain: typeof read.domain === "string" ? read.domain.slice(0, 40) : null,
      lengthMinutes: typeof read.lengthMinutes === "number" ? Math.round(read.lengthMinutes) : null,
    }
    await prisma.contentRead
      .upsert({ where: { key }, create: { key, ...content }, update: content })
      .catch((err) => logger.warn(`Could not store the video read: ${(err as Error).message}`))
  }
  return read
}
