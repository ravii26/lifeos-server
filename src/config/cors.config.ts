import { CorsOptions } from "cors"
import { env } from "./env.config.js"

export const corsOptions: CorsOptions = {
  origin: env.NODE_ENV === "production"
    ? ["https://lifeos.app"]
    : ["http://localhost:5173", "http://localhost:3001"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}
