import "./config/env.config.js"
import express from "express"
import cors from "cors"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import { corsOptions } from "./config/cors.config.js"
import { requestIdMiddleware } from "./shared/middleware/requestId.middleware.js"
import { loggerMiddleware } from "./shared/middleware/logger.middleware.js"
import { errorMiddleware } from "./shared/middleware/error.middleware.js"
import { UPLOADS_ROOT } from "./lib/storage.js"
import apiRoutes from "./modules/index.js"
import prisma from "./lib/prisma.js"

const app = express()

// Trust the first proxy hop (Render/Railway/Fly/Nginx etc.) so express-rate-limit
// and req.ip see the real client IP instead of the proxy's.
app.set("trust proxy", 1)

// Security. crossOriginResourcePolicy is relaxed to "cross-origin" so the web
// client (a different origin) can load capture media served from /uploads.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }))
app.use(cors(corsOptions))

// Correlation ID — must run before anything that logs, so every log line and
// error response can be tied back to the same request.
app.use(requestIdMiddleware)

// Global rate limiting
app.use(rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later"
}))

// Stricter limiter on auth endpoints to slow credential brute-forcing
app.use("/api/v1/auth", rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many authentication attempts, please try again later"
}))

// Body parsing (capped to avoid large-payload abuse)
app.use(express.json({ limit: "1mb" }))
app.use(express.urlencoded({ extended: true, limit: "1mb" }))

// Logging
app.use(loggerMiddleware)

// Static serving of uploaded capture media (images / voice notes). Long cache
// since filenames are content-unique (uuid). Swap to a CDN when media moves to
// cloud storage.
app.use(
  "/uploads",
  express.static(UPLOADS_ROOT, { maxAge: "7d", immutable: true }),
)

// Health check — verifies DB connectivity so a Neon outage is caught, not
// just process liveness.
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: "ok", db: "ok", timestamp: new Date().toISOString() })
  } catch {
    res.status(503).json({ status: "error", db: "unreachable", timestamp: new Date().toISOString() })
  }
})

// API routes — all modules mounted under /api/v1
app.use("/api/v1", apiRoutes)

// Error handler — must be last
app.use(errorMiddleware)

export default app
