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

// Security
app.use(helmet())
app.use(cors(corsOptions))

// Rate limiting
app.use(rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000,
  message: "Too many requests, please try again later"
}))

// Body parsing
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

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
