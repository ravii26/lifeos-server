import { Router } from "express"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { validate } from "../../shared/middleware/validate.middleware.js"
import { getSeasonController, startSeasonController, moveAreaController, seasonReviewController, extendSeasonController } from "./season.controller.js"
import { startSeasonSchema, moveAreaSchema, extendSeasonSchema } from "./season.schema.js"

const router = Router()

router.use(authenticate)

// GET  /season            the current chapter, every area's place, the line for Now
// POST /season            start a season (setup or after the season review)
// POST /season/areas/:id  move one area; a full place answers with what is there
// GET  /season/review     the season-end review: totals, parked areas, next season pre-filled
// POST /season/extend     "carry it on": a few more weeks on the same chapter
router.get("/", getSeasonController)
router.post("/", validate(startSeasonSchema), startSeasonController)
router.post("/areas/:id", validate(moveAreaSchema), moveAreaController)
router.get("/review", seasonReviewController)
router.post("/extend", validate(extendSeasonSchema), extendSeasonController)

export default router
