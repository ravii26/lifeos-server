import { Router, type Request, type Response } from "express"
import { z } from "zod"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { validate } from "../../shared/middleware/validate.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { answerKnowService, getKnowService } from "./getknow.service.js"

const router = Router()
router.use(authenticate)

// GET /know: the next "get to know you" question, or null. No AI.
router.get("/", async (req: Request, res: Response) => {
  sendSuccess(res, "Question", await getKnowService(req.user!.id))
})

// POST /know: answer it (tapped or typed) or skip it.
const answerSchema = z.object({
  id: z.string().max(40),
  answer: z.string().max(500).optional(),
  skip: z.boolean().optional(),
})
router.post("/", validate(answerSchema), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof answerSchema>
  sendSuccess(res, "Thanks", await answerKnowService(req.user!.id, b.id, { answer: b.answer, skip: b.skip }))
})

export default router
