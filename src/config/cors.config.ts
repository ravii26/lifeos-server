import { CorsOptions } from "cors"
import { env } from "./env.config.js"

// Allowed origins come from CORS_ORIGINS (comma-separated) when set; otherwise
// fall back to sensible local dev defaults.
const allowedOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : ["http://localhost:5173", "http://localhost:3001"]

export const corsOptions: CorsOptions = {
  // Allow requests with no Origin (mobile apps, curl, server-to-server) and any
  // explicitly allow-listed origin. Everything else is rejected.
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error("Not allowed by CORS"))
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}
