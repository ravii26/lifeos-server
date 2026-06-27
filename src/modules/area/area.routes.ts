import { Router } from "express"
import {
  createAreaController,
  listAreasController,
  getAreaController,
  updateAreaController,
  deleteAreaController,
  snapshotAreaScoreController,
  listAreaSnapshotsController,
  getAreaTrendsController,
} from "./area.controller.js"
import { validate } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { createAreaSchema, updateAreaSchema } from "./area.schema.js"

const router = Router()

// All area routes are protected — areas are personal to each user.
router.use(authenticate)

router.post("/", validate(createAreaSchema), createAreaController)
router.get("/", listAreasController)

// Trends across all areas (direction, delta, weakness) — must be before /:id
// so the literal "/trends" path isn't captured by the ":id" param route.
router.get("/trends", getAreaTrendsController)

router.get("/:id", getAreaController)
router.patch("/:id", validate(updateAreaSchema), updateAreaController)
router.delete("/:id", deleteAreaController)

// A3 — score history
router.post("/:id/snapshot", snapshotAreaScoreController)
router.get("/:id/snapshots", listAreaSnapshotsController)

export default router
