import { Router } from "express"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { validate } from "../../shared/middleware/validate.middleware.js"
import { getSeasonController, startSeasonController, moveAreaController } from "./season.controller.js"
import { startSeasonSchema, moveAreaSchema } from "./season.schema.js"

const router = Router()

router.use(authenticate)

// GET  /season            the current chapter, every area's place, the line for Now
// POST /season            start a season (setup or after the season review)
// POST /season/areas/:id  move one area; a full place answers with what is there
router.get("/", getSeasonController)
router.post("/", validate(startSeasonSchema), startSeasonController)
router.post("/areas/:id", validate(moveAreaSchema), moveAreaController)

export default router
