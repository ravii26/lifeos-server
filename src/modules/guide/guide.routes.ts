import { Router } from "express"
import {
  getTonightController,
  swapTonightController,
  respondTonightController,
  historyController,
  nextController,
  createSaveController,
  decideSaveController,
  batchSavesController,
  decideManySavesController,
  savesSummaryController,
  getSaveController,
  listSavesController,
  setSavePurposeController,
  listMoodsController,
  setSaveMoodsController,
} from "./guide.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { uploadSaveMedia } from "../../shared/middleware/upload.middleware.js"
import { respondSchema, historySchema, createSaveSchema, decideSaveSchema, savePurposeSchema, saveMoodsSchema, batchSavesSchema, decideManySchema } from "./guide.schema.js"

const router = Router()

router.use(authenticate)

// GET /guide/tonight — tonight's one thing (picked once per local day).
router.get("/tonight", getTonightController)
// POST /guide/tonight/swap — "not this one", next best option.
router.post("/tonight/swap", swapTonightController)
// POST /guide/tonight/respond — Done / Minimum / Skipped (+ why).
router.post("/tonight/respond", validate(respondSchema), respondTonightController)
// GET /guide/next — "one more?" after tonight is done (not saved).
router.get("/next", nextController)
// GET /guide/history?days=14 — planned vs. did.
router.get("/history", validateQuery(historySchema), historyController)

// POST /guide/saves — share a link/text/screenshot; returns one proposed action.
router.post("/saves", uploadSaveMedia, validate(createSaveSchema), createSaveController)
// POST /guide/saves/batch — up to 10 links at once (before /saves/:id routes).
router.post("/saves/batch", validate(batchSavesSchema), batchSavesController)
// POST /guide/saves/decide-many — Watch later or let go for several saves.
router.post("/saves/decide-many", validate(decideManySchema), decideManySavesController)
// GET /guide/saves/summary — what became of the saves, and which are old.
router.get("/saves/summary", savesSummaryController)
// POST /guide/saves/:id/decide — ACTION (make it a task) | SHELF (hard days) | DROP.
router.post("/saves/:id/decide", validate(decideSaveSchema), decideSaveController)
// GET /guide/saves — waiting for a decision, or on the shelf.
router.get("/saves", listSavesController)
// GET /guide/saves/moods — common moods plus the person's own (before /saves/:id).
router.get("/saves/moods", listMoodsController)
// GET /guide/saves/:id — current state (poll for the video summary).
router.get("/saves/:id", getSaveController)
// POST /guide/saves/:id/purpose — correct the guess: LEARN | FEELING.
router.post("/saves/:id/purpose", validate(savePurposeSchema), setSavePurposeController)
// POST /guide/saves/:id/moods — when it should come back: their own words allowed.
router.post("/saves/:id/moods", validate(saveMoodsSchema), setSaveMoodsController)

export default router
