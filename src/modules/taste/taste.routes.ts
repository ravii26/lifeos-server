import { Router } from "express"
import type { Request, Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { ValidationError } from "../../shared/utils/errors.util.js"
import { DECISIONS } from "./taste.rules.js"
import { decideTastesService, startTastesService, suggestTastesService } from "./taste.service.js"

const router = Router()
router.use(authenticate)

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value)
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check what was sent.")
  return r.data
}

const taste = z.object({ title: z.string().max(150), minutes: z.number().int().optional() })

// POST /tastes/:areaId/suggest — three tastes to start from (nothing saved).
router.post("/:areaId/suggest", async (req: Request, res: Response) => {
  const b = parse(z.object({ note: z.string().max(200).nullish() }), req.body ?? {})
  sendSuccess(res, "Tastes", await suggestTastesService(req.user!.id, String(req.params.areaId), b.note))
})

// POST /tastes/:areaId — start a round with these three (the person may have edited them).
router.post("/:areaId", async (req: Request, res: Response) => {
  const b = parse(z.object({ tastes: z.array(taste).max(3) }), req.body)
  sendSuccess(res, "Tastes started", await startTastesService(req.user!.id, String(req.params.areaId), b.tastes), 201)
})

// POST /tastes/:areaId/decide — keep going, change direction, or drop it for now.
router.post("/:areaId/decide", async (req: Request, res: Response) => {
  const b = parse(z.object({ decision: z.enum(DECISIONS) }), req.body)
  sendSuccess(res, "Decided", await decideTastesService(req.user!.id, String(req.params.areaId), b.decision))
})

export default router
