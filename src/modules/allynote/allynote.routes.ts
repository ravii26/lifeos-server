import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { NotFoundError, ValidationError } from "../../shared/utils/errors.util.js"
import { listAllyNotesService, updateAllyNoteService, deleteAllyNoteService } from "./allynote.service.js"
import { searchAllService } from "../search/search.service.js"
import prisma from "../../lib/prisma.js"

const router = Router()
router.use(authenticate)

// GET /ally-notes — everything you taught Ally.
router.get("/", async (req: Request, res: Response) => sendSuccess(res, "Notes", await listAllyNotesService(req.user!.id)))

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
