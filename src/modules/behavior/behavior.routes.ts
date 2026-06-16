import { Router } from "express"
import { recordBehaviorController, listBehaviorController } from "./behavior.controller.js"
import { validate, validateQuery } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { logBehaviorSchema, listBehaviorSchema } from "./behavior.schema.js"

const router = Router()

router.use(authenticate)

router.post("/", validate(logBehaviorSchema), recordBehaviorController)
router.get("/", validateQuery(listBehaviorSchema), listBehaviorController)

export default router
