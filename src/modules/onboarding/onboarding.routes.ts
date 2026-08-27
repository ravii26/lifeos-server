import { Router } from "express"
import { extractOnboardingController } from "./onboarding.controller.js"
import { validate } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { extractOnboardingSchema } from "./onboarding.schema.js"

const router = Router()

router.use(authenticate)

router.post("/extract", validate(extractOnboardingSchema), extractOnboardingController)

export default router
