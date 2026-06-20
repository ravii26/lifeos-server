import { Router } from "express"
import {
  createBlockController,
  listBlocksController,
  getBlockController,
  updateBlockController,
  deleteBlockController,
  upsertExceptionController,
  deleteExceptionController,
  splitSeriesController,
  listConflictsController,
} from "./calendar.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import {
  createBlockSchema,
  updateBlockSchema,
  listBlocksSchema,
  listConflictsSchema,
  upsertExceptionSchema,
  splitSeriesSchema,
} from "./calendar.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createBlockSchema), createBlockController)
router.get("/", validateQuery(listBlocksSchema), listBlocksController)
router.get("/conflicts", validateQuery(listConflictsSchema), listConflictsController)
router.get("/:id", getBlockController)
router.patch("/:id", validate(updateBlockSchema), updateBlockController)
router.delete("/:id", deleteBlockController)

// Per-occurrence overrides for a recurring block (move/rename/skip one instance).
router.put("/:id/exceptions", validate(upsertExceptionSchema), upsertExceptionController)
router.delete("/:id/exceptions", deleteExceptionController)

// "This and following" — split a recurring series at a given occurrence.
router.post("/:id/split", validate(splitSeriesSchema), splitSeriesController)

export default router
