import "./config/env.config.js"
import express from "express"
import cors from "cors"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import { corsOptions } from "./config/cors.config.js"
import { loggerMiddleware } from "./shared/middleware/logger.middleware.js"
import { errorMiddleware } from "./shared/middleware/error.middleware.js"
import apiRoutes from "./modules/index.js"

const app = express()

// Trust the first proxy hop (Render/Railway/Fly/Nginx etc.) so express-rate-limit
// and req.ip see the real client IP instead of the proxy's.
app.set("trust proxy", 1)

// Security
app.use(helmet())
app.use(cors(corsOptions))

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

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() })
})

// API routes — all modules mounted under /api/v1
app.use("/api/v1", apiRoutes)

// Error handler — must be last
app.use(errorMiddleware)

export default app
