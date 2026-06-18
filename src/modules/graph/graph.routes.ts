import { Router } from "express"
import { authenticate } from "../../shared/middleware/auth.middleware.js"
import { getGraphController } from "./graph.controller.js"

const router = Router()

router.use(authenticate)
router.get("/", getGraphController)

export default router
