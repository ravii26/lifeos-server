import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { listAllyNotesService, updateAllyNoteService, deleteAllyNoteService } from "./allynote.service.js"
import { searchAllService } from "../search/search.service.js"
import prisma from "../../lib/prisma.js"
import { runWithAiFallback } from "../../lib/ai-fallback.js"
import { geminiClient, GEMINI_MODEL } from "../../lib/gemini.js"
import { groqClient } from "../../lib/groq.js"
import { addUtcDays, dateFromKey, localDayStartMs, utcDayKey } from "../../shared/utils/time.util.js"
import { recordActivity } from "../activity/activity.service.js"
import { getClock } from "../now/now.service.js"
import { cleanDraft, draftPrompt, fallbackDraft, rulesForToday } from "./allynote.extras.rules.js"

const router = Router()
router.use(authenticate)

// GET /ally-notes — everything you taught Ally.
router.get("/", async (req: Request, res: Response) => sendSuccess(res, "Notes", await listAllyNotesService(req.user!.id)))

const metaOf = (m: unknown): Record<string, unknown> => (m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {})

// GET /ally-notes/for-today — rules switched on to show before an event, when
// something on today or tomorrow matches what they are for ("party", "interview").
router.get("/for-today", async (req: Request, res: Response) => {
  const userId = req.user!.id
  const c = await getClock(userId)
  const start = new Date(localDayStartMs(c.todayKey, c.tz))
  const end = new Date(localDayStartMs(utcDayKey(addUtcDays(dateFromKey(c.todayKey), 2)), c.tz))
  const [notes, tasks] = await Promise.all([
    prisma.allyNote.findMany({ where: { userId, collection: { not: "People" } }, select: { id: true, title: true, collection: true, items: true, meta: true } }),
    prisma.task.findMany({
      where: {
        userId,
        archivedAt: null,
        status: { in: ["TODO", "IN_PROGRESS"] },
        OR: [{ dueDate: { gte: dateFromKey(c.todayKey), lt: addUtcDays(dateFromKey(c.todayKey), 2) } }, { remindAt: { gte: start, lt: end } }],
      },
      select: { title: true },
      take: 100,
    }),
  ])
  const rules = notes.map((n) => ({ id: n.id, title: n.title, collection: n.collection, items: n.items, showBefore: metaOf(n.meta).showBefore === true }))
  sendSuccess(res, "Rules for today", rulesForToday(rules, tasks))
})

// POST /ally-notes/:id/when-needed — show these rules before a matching event, or stop. Undo puts it back.
router.post("/:id/when-needed", async (req: Request, res: Response) => {
  const userId = req.user!.id
  const on = z.object({ on: z.boolean() }).parse(req.body).on
  const note = await prisma.allyNote.findFirst({ where: { id: String(req.params.id), userId }, select: { id: true, title: true, meta: true } })
  if (!note) throw new NotFoundError("Note not found")
  const meta = metaOf(note.meta)
  await prisma.allyNote.update({ where: { id: note.id }, data: { meta: { ...meta, showBefore: on } as never } })
  const ev = await recordActivity(userId, {
    type: "UPDATED",
    itemType: "NOTE",
    itemId: note.id,
    title: on ? `Show "${note.title}" when needed` : `Stop showing "${note.title}"`,
    source: "APP",
    undo: { kind: "RESTORE_FIELDS", model: "allyNote", id: note.id, prev: { meta } },
  })
  sendSuccess(res, "Saved", { on, activityId: ev?.id ?? null })
})

// POST /ally-notes/:id/draft — a message for this person, to copy and send yourself. Ally never sends it.
router.post("/:id/draft", async (req: Request, res: Response) => {
  const userId = req.user!.id
  const note = await prisma.allyNote.findFirst({ where: { id: String(req.params.id), userId, collection: "People" }, select: { title: true, items: true, meta: true } })
  if (!note) throw new NotFoundError("Person not found")
  const last = Date.parse(String(metaOf(note.meta).lastContact ?? ""))
  const days = Number.isFinite(last) ? Math.floor((Date.now() - last) / 86_400_000) : null
  const prompt = draftPrompt(note.title, note.items, days)
  const raw = await runWithAiFallback<string | null>(
    "Person draft",
    {
      gemini: geminiClient ? async () => (await geminiClient!.getGenerativeModel({ model: GEMINI_MODEL }).generateContent(prompt)).response.text() : undefined,
      groq: groqClient
        ? async () => (await groqClient!.chat.completions.create({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: prompt }] })).choices[0]?.message?.content ?? null
        : undefined,
    },
    () => null,
  )
  const message = cleanDraft(raw)
  sendSuccess(res, "Draft", { message: message ?? fallbackDraft(note.title, days), byCode: message === null })
})

const patch = z.object({
  collection: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  items: z.array(z.string().max(300)).max(50).optional(),
  text: z.string().max(4000).nullable().optional(),
  add: z.array(z.string().max(300)).max(20).optional(),
  remove: z.array(z.string().max(300)).max(20).optional(),
})

router.patch("/:id", async (req: Request, res: Response) => {
  const r = patch.safeParse(req.body)
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid input")
  const out = await updateAllyNoteService(req.user!.id, String(req.params.id), r.data)
  if (!out) throw new NotFoundError("Note not found")
  sendSuccess(res, "Note updated", out)
})

// POST /ally-notes/:id/tick — tick or untick one item of a list or routine (ticking never deletes).
router.post("/:id/tick", async (req: Request, res: Response) => {
  const r = z.object({ item: z.string().trim().min(1).max(300), done: z.boolean() }).safeParse(req.body)
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid input")
  const out = await updateAllyNoteService(req.user!.id, String(req.params.id), r.data.done ? { tick: [r.data.item] } : { untick: [r.data.item] })
  if (!out) throw new NotFoundError("Note not found")
  sendSuccess(res, "Note updated", out)
})

// POST /ally-notes/:id/reset — untick everything (start a routine again) or clear what was ticked.
router.post("/:id/reset", async (req: Request, res: Response) => {
  const r = z.object({ clear: z.boolean().default(false) }).safeParse(req.body ?? {})
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid input")
  const note = await prisma.allyNote.findFirst({ where: { id: String(req.params.id), userId: req.user!.id }, select: { done: true } })
  if (!note) throw new NotFoundError("Note not found")
  const out = await updateAllyNoteService(req.user!.id, String(req.params.id), r.data.clear ? { clearDone: true } : { untick: note.done })
  sendSuccess(res, "Note updated", out)
})

// POST /ally-notes/:id/contacted — you just called or messaged this person (from their card).
// Kept in the note's meta so People can say "it's been a while"; not an activity, so not in the Log.
router.post("/:id/contacted", async (req: Request, res: Response) => {
  const note = await prisma.allyNote.findFirst({ where: { id: String(req.params.id), userId: req.user!.id, collection: "People" }, select: { id: true, meta: true } })
  if (!note) throw new NotFoundError("Person not found")
  const meta = note.meta && typeof note.meta === "object" && !Array.isArray(note.meta) ? (note.meta as Record<string, unknown>) : {}
  const out = await prisma.allyNote.update({ where: { id: note.id }, data: { meta: { ...meta, lastContact: new Date().toISOString() } } })
  sendSuccess(res, "Noted", out)
})

router.delete("/:id", async (req: Request, res: Response) => {
  const out = await deleteAllyNoteService(req.user!.id, String(req.params.id))
  if (!out) throw new NotFoundError("Note not found")
  sendSuccess(res, "Note deleted", out)
})

export const searchRouter = Router()
searchRouter.use(authenticate)
// GET /search?q=caching — notes, to-dos, saves, goals, memories.
searchRouter.get("/", async (req: Request, res: Response) => {
  const q = z.string().trim().min(1).max(200).safeParse(req.query.q)
  if (!q.success) throw new ValidationError("q is required")
  sendSuccess(res, "Search", await searchAllService(req.user!.id, q.data))
})

export default router
