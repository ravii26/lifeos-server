import { Router } from "express"
import { getIdentityController, upsertIdentityController } from "./identity.controller.js"
import { validate } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { upsertIdentitySchema } from "./identity.schema.js"

const router = Router()

router.use(authenticate)

// One record per user — no :id needed.
router.get("/", getIdentityController)
router.put("/", validate(upsertIdentitySchema), upsertIdentityController)

export default router
