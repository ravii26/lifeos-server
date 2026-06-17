import { z } from "zod"
import dotenv from "dotenv"

dotenv.config()

const envSchema = z.object({
  DATABASE_URL:   z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET:     z.string().min(1, "JWT_SECRET is required"),
  PORT:           z.string().default("3000"),
  NODE_ENV:       z.enum(["development", "production", "test"]).default("development"),
  GEMINI_API_KEY: z.string().optional(), // optional — falls back to heuristic classifier when absent
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error("Invalid environment variables:")
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
