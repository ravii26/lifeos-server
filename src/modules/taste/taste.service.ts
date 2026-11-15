// Three small tastes in an area: suggest, start, decide. Each change can be undone.

import type { ActivitySource } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { recordActivity, type UndoPayload } from "../activity/activity.service.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { cleanTastes, decisionWords, fallbackTastes, roundOf, TASTES_KIND, tasteTitle, type Decision, type Taste } from "./taste.rules.js"

const ownedArea = async (userId: string, areaId: string) => {
  const a = await prisma.area.findFirst({ where: { id: areaId, userId }, select: { id: true, name: true, tier: true, laterUntil: true } })
  if (!a) throw new NotFoundError("Area not found")
  return a
}

const PROMPT = (area: string, note: string | null) => `Someone is unsure whether they want "${area}" in their life.${note ? ` They said: "${note}".` : ""}
Suggest three small, real tastes of it, from easiest to most real, each something they can do alone at home or nearby with no purchase, in 15 to 90 minutes.
Return JSON only: {"tastes": [{"title": string, "minutes": number}]}
Titles are short instructions in plain words ("Learn three chords on a free keyboard app"), no numbering.`

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    return m ? JSON.parse(m[0]) : null
  }
}

// Three tastes to start from. The AI only suggests wording; code keeps it to
// three, sized and sane, and without AI the generic three are offered.
export const suggestTastesService = async (userId: string, areaId: string, note?: string | null): Promise<{ tastes: Taste[]; byCode: boolean }> => {
  const a = await ownedArea(userId, areaId)
  const said = note?.trim().slice(0, 200) || null
  const raw = await runWithAiFallback<unknown | null>(
    "Tastes",
    {
      gemini: geminiClient
        ? async () => {
            const model = geminiClient!.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json" } })
            return parse((await model.generateContent(PROMPT(a.name, said))).response.text())
          }
        : undefined,
      groq: groqClient
        ? async () => {
            const r = await groqClient!.chat.completions.create({
              model: "openai/gpt-oss-120b",
              response_format: { type: "json_object" },
              messages: [{ role: "user", content: PROMPT(a.name, said) }],
            })
            return parse(r.choices[0]?.message?.content || "{}")
          }
        : undefined,
    },
    () => null,
  )
  return raw === null ? { tastes: fallbackTastes(a.name), byCode: true } : { tastes: cleanTastes(raw, a.name), byCode: false }
}

// Start a round: a TASTES goal in the area and its three taste to-dos.
export const startTastesService = async (userId: string, areaId: string, input: unknown, source: ActivitySource = "APP") => {
  const a = await ownedArea(userId, areaId)
  const open = await prisma.goal.findFirst({ where: { userId, areaId, kind: TASTES_KIND, status: "ACTIVE" }, select: { id: true } })
  if (open) throw new ValidationError("This area already has tastes going. Finish or decide those first.")
  const tastes = cleanTastes(input, a.name)
  const goal = await prisma.goal.create({
    data: { userId, areaId, title: `Trying ${a.name}`.slice(0, 200), kind: TASTES_KIND, why: "Three small tastes, then decide.", activatedAt: new Date() },
  })
  const ids: string[] = []
  for (const [i, t] of tastes.entries()) {
    const task = await prisma.task.create({ data: { userId, areaId, goalId: goal.id, title: tasteTitle(i + 1, t.title), sizeMinutes: t.minutes } })
    ids.push(task.id)
  }
  const undo: UndoPayload = {
    kind: "MANY",
    items: [...ids.map((taskId) => ({ kind: "ARCHIVE_TASK" as const, taskId })), { kind: "RESTORE_FIELDS", model: "goal", id: goal.id, prev: { status: "ABANDONED" } }],
  }
  const ev = await recordActivity(userId, { type: "CREATED", itemType: "TASK", itemId: goal.id, title: `Three tastes of ${a.name}`, source, undo })
  return { goalId: goal.id, message: `Three tastes of ${a.name} added. Each comes up in your free time.`, activityId: ev?.id }
}

// The decision after the tastes. KEEP and CHANGE close the round (the app then
// makes a goal concrete, or plans new tastes); DROP also rests the area.
export const decideTastesService = async (userId: string, areaId: string, decision: Decision, source: ActivitySource = "APP") => {
  const a = await ownedArea(userId, areaId)
  const goal = await prisma.goal.findFirst({ where: { userId, areaId, kind: TASTES_KIND, status: "ACTIVE" }, select: { id: true } })
  if (!goal) throw new NotFoundError("No tastes going in this area")
  // Tastes not done yet are let go with the round; Undo brings them back.
  const open = await prisma.task.findMany({ where: { userId, goalId: goal.id, archivedAt: null, status: { not: "COMPLETED" } }, select: { id: true, status: true } })
  await prisma.goal.update({ where: { id: goal.id }, data: { status: "COMPLETED" } })
  if (open.length) await prisma.task.updateMany({ where: { id: { in: open.map((t) => t.id) } }, data: { status: "CANCELLED", archivedAt: new Date() } })
  const items: UndoPayload[] = [
    { kind: "RESTORE_FIELDS", model: "goal", id: goal.id, prev: { status: "ACTIVE" } },
    ...open.map((t) => ({ kind: "RESTORE_FIELDS" as const, model: "task" as const, id: t.id, prev: { status: t.status, archivedAt: null } })),
  ]
  if (decision === "DROP") {
    await prisma.area.update({ where: { id: a.id }, data: { tier: "LATER", laterUntil: null } })
    items.push({ kind: "RESTORE_FIELDS", model: "area", id: a.id, prev: { tier: a.tier, laterUntil: a.laterUntil ? a.laterUntil.toISOString() : null } })
  }
  const message = decisionWords(decision, a.name)
  const ev = await recordActivity(userId, { type: "UPDATED", itemType: "TASK", itemId: goal.id, title: message, reason: `tastes:${decision.toLowerCase()}`, source, undo: { kind: "MANY", items } })
  return { message, activityId: ev?.id }
}

// The open round per area, for the overview.
export const tasteRounds = async (userId: string) => {
  const goals = await prisma.goal.findMany({
    where: { userId, kind: TASTES_KIND, status: "ACTIVE" },
    select: { id: true, areaId: true, tasks: { select: { status: true, archivedAt: true } } },
  })
  return new Map(goals.map((g) => [g.areaId, roundOf(g.id, g.tasks)]))
}
