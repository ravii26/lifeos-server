// The "doing it" screen's words for one step: where it came from, how to
// begin, what done looks like; and a clearer wording when a step isn't clear.
// Reads only. The AI writes at most two short lines, checked by brief.rules.ts.

import prisma from "../../lib/prisma.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { NotFoundError } from "../../shared/utils/errors.util.js"
import { briefByCode, briefPrompt, checkBrief, checkClearer, clearerPrompt, type Brief } from "./brief.rules.js"

const json = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    try {
      return m ? JSON.parse(m[0]) : null
    } catch {
      return null
    }
  }
}

const ask = (label: string, prompt: string): Promise<unknown | null> =>
  runWithAiFallback<unknown | null>(
    label,
    {
      gemini: geminiClient
        ? async () => {
            const model = geminiClient!.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json", maxOutputTokens: 200 } })
            return json((await model.generateContent(prompt)).response.text())
          }
        : undefined,
      groq: groqClient
        ? async () => {
            const r = await groqClient!.chat.completions.create({
              model: "openai/gpt-oss-120b",
              response_format: { type: "json_object" },
              max_tokens: 300,
              reasoning_effort: "low",
              messages: [{ role: "user", content: prompt }],
            })
            return json(r.choices[0]?.message?.content || "{}")
          }
        : undefined,
    },
    () => null,
  )

const load = async (userId: string, id: string) => {
  const t = await prisma.task.findFirst({
    where: { id, userId, archivedAt: null },
    select: {
      id: true, title: true, sizeMinutes: true, targetMinutes: true, minimumVersion: true, updatedAt: true,
      area: { select: { name: true } },
      goal: { select: { title: true, why: true, area: { select: { name: true } }, parent: { select: { title: true, why: true } } } },
      project: { select: { title: true, goal: { select: { title: true, why: true } } } },
    },
  })
  if (!t) throw new NotFoundError("Step not found")
  return t
}

// The AI's lines for a step are kept while the server runs, so opening the
// same step again costs nothing. Keyed by the step as it is now: an edit asks again.
const kept = new Map<string, Brief>()
const KEEP = 500

export interface BriefDto extends Brief {
  title: string
  minutes: number | null
  smaller: string | null
  /** What it is part of: a goal, with its why; else the area. */
  from: { goal: string | null; why: string | null; area: string | null; milestone: string | null }
}

export const stepBriefService = async (userId: string, id: string): Promise<BriefDto> => {
  const t = await load(userId, id)
  // A step under a milestone is part of the big goal; the milestone says which stretch of it.
  const milestone = t.goal?.parent ? t.goal.title : null
  const goal = t.goal?.parent ?? t.goal ?? t.project?.goal ?? null
  const input = { title: t.title, minutes: t.sizeMinutes ?? t.targetMinutes ?? null, smaller: t.minimumVersion }
  const from = { goal: goal?.title ?? t.project?.title ?? null, why: goal?.why ?? null, area: t.area?.name ?? t.goal?.area?.name ?? null, milestone }
  const key = `${t.id}:${t.updatedAt.getTime()}`
  let brief = kept.get(key)
  if (!brief) {
    const raw = await ask("Step brief", briefPrompt({ ...input, goal: from.goal, why: from.why, area: from.area })).catch(() => null)
    brief = raw === null ? briefByCode(input) : checkBrief(raw, input)
    if (!brief.byCode) {
      if (kept.size >= KEEP) kept.delete(kept.keys().next().value as string)
      kept.set(key, brief)
    }
  }
  return { ...brief, ...input, from }
}

/** A clearer wording for a step that isn't clear. Nothing is saved; null when the AI has none. */
export const clearerStepService = async (userId: string, id: string): Promise<{ title: string | null }> => {
  const t = await load(userId, id)
  const raw = await ask("Step clearer", clearerPrompt(t.title, t.goal?.title ?? t.project?.goal?.title ?? null)).catch(() => null)
  return { title: checkClearer(raw, t.title) }
}
