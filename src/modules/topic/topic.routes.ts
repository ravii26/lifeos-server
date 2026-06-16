import { Router } from "express"
import {
  createTopicController,
  listTopicsController,
  getTopicController,
  updateTopicController,
  deleteTopicController,
} from "./topic.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { createTopicSchema, updateTopicSchema, listTopicsSchema } from "./topic.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(createTopicSchema), createTopicController)
router.get("/", validateQuery(listTopicsSchema), listTopicsController)
router.get("/:id", getTopicController)
router.patch("/:id", validate(updateTopicSchema), updateTopicController)
router.delete("/:id", deleteTopicController)

export default router
