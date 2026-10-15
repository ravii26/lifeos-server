import { z } from "zod"
import dotenv from "dotenv"

dotenv.config()

// A blank line in an env file ("AICREDITS_API_KEY=") means "not set", not an invalid value.
const blankIsUnset = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema)

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  PORT: z.string().default("3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Comma-separated list of allowed browser origins (e.g. "https://app.lifeos.app,https://lifeos.app")
  CORS_ORIGINS: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.5-flash-lite"),
  GROQ_API_KEY: z.string().optional(),
  // AICredits (aicredits.in): an OpenAI-compatible gateway with INR billing.
  AICREDITS_API_KEY: z.string().optional(),
  // Comma-separated, provider-prefixed model ids (default: cheap and reliable ones).
  AICREDITS_MODELS: z.string().optional(),
  // Soft cap per server process per day, so a flood of messages cannot spend the balance.
  AICREDITS_DAILY_CALL_LIMIT: blankIsUnset(z.coerce.number().int().positive().default(1500)),
  // Which provider to try first. Unset: AICredits when its key is set, else Groq.
  PREFERRED_AI_PROVIDER: blankIsUnset(z.enum(["aicredits", "gemini", "groq"]).optional()),
  PUBLIC_BASE_URL: z.string().url().optional(),
  // Comma-separated emails that can open the admin page (AI cost, saves, users).
  ADMIN_EMAILS: z.string().optional(),
  // Extra or corrected model prices for the admin page (see config/ai-prices.ts).
  AI_PRICES_JSON: blankIsUnset(z.string().optional()),
  // Rupees per US dollar, for showing AI cost in ₹.
  AI_USD_INR: blankIsUnset(z.coerce.number().positive().default(88)),
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
