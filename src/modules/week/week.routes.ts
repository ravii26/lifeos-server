import { Router } from "express"
import type { Request, Response } from "express"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { sendSuccess } from "../../shared/utils/response.util.js"
import { getWeekService } from "./week.service.js"

const router = Router()
router.use(authenticate)

// GET /week — this week by day and area, routines as dots, time per area, and
// in the first week of a month a look back at the month before.
router.get("/", async (req: Request, res: Response) => {
  sendSuccess(res, "Week", await getWeekService(req.user!.id, typeof req.query.at === "string" ? req.query.at : undefined))
})

export default router
