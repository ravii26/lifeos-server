import { Router } from "express"
import {
  createReviewController,
  listReviewsController,
  getReviewController,
  updateReviewController,
  deleteReviewController,
  draftReviewController,
  createInsightController,
  listInsightsController,
  updateInsightController,
  deleteInsightController,
} from "./review.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import {
  createReviewSchema,
  updateReviewSchema,
  listReviewsSchema,
  draftReviewSchema,
  createInsightSchema,
  updateInsightSchema,
} from "./review.schema.js"

const router = Router()

router.use(authenticate)

// Insight-review (standalone update/delete) — declared before "/:id" routes.
router.patch("/insights/:insightId", validate(updateInsightSchema), updateInsightController)
router.delete("/insights/:insightId", deleteInsightController)

// Reviews
router.post("/", validate(createReviewSchema), createReviewController)
router.get("/", validateQuery(listReviewsSchema), listReviewsController)
// Auto-draft generator — declared before "/:id" so the literal path wins.
router.get("/draft", validateQuery(draftReviewSchema), draftReviewController)
router.get("/:id", getReviewController)
router.patch("/:id", validate(updateReviewSchema), updateReviewController)
router.delete("/:id", deleteReviewController)

// Insight-reviews nested under a review
router.post("/:id/insights", validate(createInsightSchema), createInsightController)
router.get("/:id/insights", listInsightsController)

export default router
