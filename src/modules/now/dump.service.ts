/* =====================================================================
   POST /now/dump: "My head is full". Splits the dump (AI, or plain code
   when no AI answers), saves each new thing as a to-do in one go with one
   Undo, sorts them by code, and checks the whole list against free time.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { dateFromKey } from "../../shared/utils/time.util.js"
import { recordActivity } from "../activity/activity.service.js"
import { createTask } from "../task/task.repository.js"
import { getClock } from "./now.service.js"
import { getPileService } from "./pile.service.js"
import { splitDump, parseDumpJson, groupOf, timeCheck, dumpPrompt, DEFAULT_ITEM_MINUTES, type DumpItem, type DumpGroup } from "./dump.rules.js"

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

const splitWithAi = async (text: string, areas: { id: string; name: string }[], todayKey: string): Promise<{ items: DumpItem[]; fromAi: boolean }> => {
  const ctx = { areaIds: new Set(areas.map((a) => a.id)), todayKey }
  const p = dumpPrompt(text, areas, todayKey, WEEKDAYS[dateFromKey(todayKey).getUTCDay()]!)
  return runWithAiFallback<{ items: DumpItem[]; fromAi: boolean }>(
    "Brain dump",
    {
      gemini: geminiClient
        ? async () => {
            const model = geminiClient!.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1500 } })
            const items = parseDumpJson((await model.generateContent([{ text: p }])).response.text(), ctx)
            if (!items.length) throw new Error("no items")
            return { items, fromAi: true }
          }
        : undefined,
      groq: groqClient
        ? async () => {
            const res = await groqClient!.chat.completions.create({
              messages: [{ role: "user", content: p }],
              model: "openai/gpt-oss-120b",
              response_format: { type: "json_object" },
              max_tokens: 1500,
              reasoning_effort: "low",
            })
            const items = parseDumpJson(res.choices[0]?.message?.content || "{}", ctx)
            if (!items.length) throw new Error("no items")
            return { items, fromAi: true }
          }
        : undefined,
    },
    () => ({ items: splitDump(text), fromAi: false }),
  )
}

export const dumpService = async (userId: string, text: string) => {
  const c = await getClock(userId)
  const [areas, open, settings] = await Promise.all([
    prisma.area.findMany({ where: { userId, isActive: true }, select: { id: true, name: true }, orderBy: { order: "asc" } }),
    prisma.task.findMany({ where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, archivedAt: null }, select: { title: true }, take: 1000 }),
    prisma.userSettings.findUnique({ where: { userId }, select: { seasonStartedAt: true } }),
  ])
  const { items, fromAi } = await splitWithAi(text, areas, c.todayKey)
  if (!items.length) throw new ValidationError("I couldn't find separate things in that. Try one thing per line.")

  // What is already on the list is not added twice; it is still counted in the time check below.
  const known = new Set(open.map((t) => norm(t.title)))
  const fresh = items.filter((i) => !known.has(norm(i.title)))
  const created = await prisma.$transaction(
    fresh.map((i) =>
      createTask({
        userId,
        title: i.title,
        areaId: i.areaId,
        dueDate: i.due ? dateFromKey(i.due) : null,
        sizeMinutes: i.minutes ?? DEFAULT_ITEM_MINUTES,
        source: "DUMP",
      }),
    ),
  )
  const event = created.length
    ? await recordActivity(userId, {
        type: "CREATED",
        itemType: "TASK",
        title: `Brain dump: ${created.length} ${created.length === 1 ? "thing" : "things"}`,
        source: "APP",
        undo: { kind: "MANY", items: created.map((t) => ({ kind: "ARCHIVE_TASK" as const, taskId: t.id })) },
      })
    : null

  const groups: Record<DumpGroup, { id: string; title: string; due: string | null }[]> = { DATED: [], THIS_WEEK: [], LATER: [] }
  created.forEach((t, n) => groups[groupOf(fresh[n]!)].push({ id: t.id, title: t.title, due: fresh[n]!.due }))
  for (const g of Object.values(groups)) g.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))

  const pile = await getPileService(userId)
  const check = timeCheck(pile.weeklyMinutes, pile.freeMinutes)
  return {
    groups,
    added: created.length,
    alreadyThere: items.length - fresh.length,
    fromAi,
    weeklyMinutes: pile.weeklyMinutes,
    freeMinutes: pile.freeMinutes,
    fits: check.fits,
    line: check.line,
    hasSeason: !!settings?.seasonStartedAt,
    activityId: event?.id ?? null,
  }
}
