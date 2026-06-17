import { Router } from "express"
import { getSettingsController, updateSettingsController } from "./settings.controller.js"
import { validate } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { updateSettingsSchema } from "./settings.schema.js"

const router = Router()

router.use(authenticate)

router.get("/", getSettingsController)
router.patch("/", validate(updateSettingsSchema), updateSettingsController)

export default router
