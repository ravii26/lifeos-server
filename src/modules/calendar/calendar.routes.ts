import { Router } from "express"
import {
  createBlockController,
  listBlocksController,
  getBlockController,
  updateBlockController,
  deleteBlockController,
} from "./calendar.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { createBlockSchema, updateBlockSchema, listBlocksSchema } from "./calendar.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createBlockSchema), createBlockController)
router.get("/", validateQuery(listBlocksSchema), listBlocksController)
router.get("/:id", getBlockController)
router.patch("/:id", validate(updateBlockSchema), updateBlockController)
router.delete("/:id", deleteBlockController)

export default router
