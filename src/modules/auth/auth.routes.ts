import { Router } from "express"
import { registerController, loginController, meController } from "./auth.controller.js"
import { validate } from "../../shared/middleware/validate.middleware.js"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { registerSchema, loginSchema } from "./auth.schema.js"

const router = Router()

// Public
router.post("/register", validate(registerSchema), registerController)
router.post("/login", validate(loginSchema), loginController)

// Protected
router.get("/me", authenticate, meController)

export default router
