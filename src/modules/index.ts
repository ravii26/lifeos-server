import { Router } from "express"
import authRoutes from "./auth/auth.routes.js"
import areaRoutes from "./area/area.routes.js"
import taskRoutes from "./task/task.routes.js"
import habitRoutes from "./habit/habit.routes.js"
import goalRoutes from "./goal/goal.routes.js"
import projectRoutes from "./project/project.routes.js"
import identityRoutes from "./identity/identity.routes.js"
import vaultRoutes from "./vault/vault.routes.js"
import topicRoutes from "./topic/topic.routes.js"
import notebookRoutes from "./notebook/notebook.routes.js"
import resourceRoutes from "./resource/resource.routes.js"
import noteRoutes from "./note/note.routes.js"
import reviewRoutes from "./review/review.routes.js"
import calendarRoutes from "./calendar/calendar.routes.js"
import focusRoutes from "./focus/focus.routes.js"
import behaviorRoutes from "./behavior/behavior.routes.js"
import captureRoutes from "./capture/capture.routes.js"
import settingsRoutes from "./settings/settings.routes.js"
import decisionsRoutes from "./decisions/decisions.routes.js"
import graphRoutes from "./graph/graph.routes.js"

const router = Router()

// Mount every module's routes here. app.ts never changes —
// only this file grows by one line as each module is added.
router.use("/auth", authRoutes)
router.use("/identity", identityRoutes)
router.use("/areas", areaRoutes)
router.use("/goals", goalRoutes)
router.use("/projects", projectRoutes)
router.use("/tasks", taskRoutes)
router.use("/habits", habitRoutes)
router.use("/vault", vaultRoutes)
router.use("/topics", topicRoutes)
router.use("/notebooks", notebookRoutes)
router.use("/resources", resourceRoutes)
router.use("/notes", noteRoutes)
router.use("/reviews", reviewRoutes)
router.use("/calendar", calendarRoutes)
router.use("/focus", focusRoutes)
router.use("/behavior", behaviorRoutes)
router.use("/captures", captureRoutes)
router.use("/settings", settingsRoutes)
router.use("/decisions", decisionsRoutes)
router.use("/graph", graphRoutes)

export default router
