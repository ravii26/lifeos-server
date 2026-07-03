import { z } from "zod"
import dotenv from "dotenv"

dotenv.config()

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  PORT: z.string().default("3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Comma-separated list of allowed browser origins (e.g. "https://app.lifeos.app,https://lifeos.app")
  CORS_ORIGINS: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  PREFERRED_AI_PROVIDER: z.enum(["gemini", "groq"]).default("gemini"),
  PUBLIC_BASE_URL: z.string().url().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error("Invalid environment variables:")
  console.error(parsed.error)
  process.exit(1)
}

export const env = parsed.data

// In production a weak/short JWT secret is a critical risk — fail fast rather than
// boot an insecure server. 32+ chars roughly matches a 256-bit random secret.
if (env.NODE_ENV === "production" && env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be at least 32 characters in production.")
  process.exit(1)
}
