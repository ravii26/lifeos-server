// POST /decide — two options → a suggestion, why, a first step, a check-in.
// POST /decide/choose — go with one: a check-in reminder on that day, with Undo.

import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import prisma from "../../lib/prisma.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { addUtcDays, dateFromKey, localDayStartMs, utcDayKey } from "../../shared/utils/time.util.js"
import { recordActivity } from "../activity/activity.service.js"
import { getClock } from "../now/now.service.js"
import { checkInDays, checkInTitle, cleanDecision, HARD, type Hard } from "./decide.rules.js"

const router = Router()
router.use(authenticate)

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value)
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check what was sent.")
  return r.data
}

const PROMPT = (a: string, b: string, hard: Hard[], note: string | null) => `Someone is stuck choosing between two options and asked for help deciding.
Option A: ${a}
Option B: ${b}
What makes it hard: ${[...hard.map((h) => h.toLowerCase()), note].filter(Boolean).join(", ") || "not said"}.
Return JSON only: {"pick": "A"|"B"|"EITHER", "why": string, "firstStep": string, "checkInDays": number}
Rules: why is one or two plain, kind sentences, no lecture. Prefer the option that is easier to undo when they are close; say EITHER when both are genuinely fine. firstStep is one concrete thing doable in 15 minutes for the picked option (or for picking, if EITHER). checkInDays 3 to 30: when they will know if it is working. Do not invent facts about them.`

const json = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    return m ? JSON.parse(m[0]) : null
  }
}

router.post("/", async (req: Request, res: Response) => {
  const b = parse(
    z.object({ a: z.string().trim().min(1).max(200), b: z.string().trim().min(1).max(200), hard: z.array(z.enum(HARD)).max(5).optional(), note: z.string().max(200).nullish() }),
    req.body,
  )
  const hard = b.hard ?? []
  const prompt = PROMPT(b.a, b.b, hard, b.note?.trim() || null)
  const raw = await runWithAiFallback<unknown | null>(
    "Decide",
    {
      gemini: geminiClient
        ? async () => {
            const model = geminiClient!.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json" } })
            return json((await model.generateContent(prompt)).response.text())
          }
        : undefined,
      groq: groqClient
        ? async () => {
            const r = await groqClient!.chat.completions.create({
              model: "openai/gpt-oss-120b",
              response_format: { type: "json_object" },
              messages: [{ role: "user", content: prompt }],
            })
            return json(r.choices[0]?.message?.content || "{}")
          }
        : undefined,
    },
    () => null,
  )
  const d = cleanDecision(raw, b.a, b.b, hard)
  sendSuccess(res, "Decision", { ...d, byCode: raw === null })
})

router.post("/choose", async (req: Request, res: Response) => {
  const userId = req.user!.id
  const b = parse(z.object({ choice: z.string().trim().min(1).max(200), checkInDays: z.number().int().optional() }), req.body)
  const c = await getClock(userId)
  const days = checkInDays(b.checkInDays ?? 7)
  const key = utcDayKey(addUtcDays(dateFromKey(c.todayKey), days))
  // A reminder at 9 in the morning, the person's time, on the check-in day.
  const remindAt = new Date(localDayStartMs(key, c.tz) + 9 * 3_600_000)
  const task = await prisma.task.create({ data: { userId, title: checkInTitle(b.choice), remindAt, dueDate: dateFromKey(key), sizeMinutes: 5 } })
  const ev = await recordActivity(userId, {
    type: "CREATED",
    itemType: "TASK",
    itemId: task.id,
    title: `Decided: ${b.choice}`,
    source: "APP",
    undo: { kind: "ARCHIVE_TASK", taskId: task.id },
  })
  sendSuccess(res, "Decided", { message: `Going with "${b.choice}". Ally will check in on ${key}.`, checkInKey: key, activityId: ev?.id }, 201)
})

export default router
