import dotenv from "dotenv"

// Loaded before any other module (see vitest.config.ts `setupFiles`) so
// env.config.ts's own `dotenv.config()` sees these values already in
// process.env and — since dotenv never overrides an existing key — keeps
// them. This points the whole test run at the isolated `lifeos_test`
// database instead of the real dev/prod ones in `.env`.
dotenv.config({ path: ".env.test", override: true })
