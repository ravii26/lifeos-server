# AGENTS.md: lifeos-server (Ally API)

> API for **Ally**, a personal assistant app (formerly LifeOS; code names keep `lifeos`).
> Full product context lives in the workspace root `AGENTS.md`, `docs/`, and `product-design/12-final-plan.md`
> (the folder that contains this repo). Working branch: **`lifeos-2.0`**.

## Commands
```bash
npm install
npm run dev            # tsx watch, :3000, API under /api/v1
npx tsc --noEmit -p .  # typecheck (must be clean)
npm run build && npm start
npm run evals          # AI scenario evals against the real AI + DB (see docs/runbooks/testing.md)
```
Integration tests: see "Testing" below. `npm test` targets the local `lifeos_test` DB, whose credentials currently fail.

## Stack
Node 24 · TypeScript ESM (`.js` import suffixes) · Express 5 · Prisma 6 (Postgres/Neon) · Zod 4 · Vitest + Supertest · Winston ·
AI: Gemini (`@google/generative-ai`) and Groq (`groq-sdk`) through `src/lib/ai-fallback.ts`.

## Layout
```
src/
  app.ts, index.ts          express app / server
  config/                   env (zod-validated), cors
  lib/                      prisma, gemini, groq, ai-fallback, logger, rag, storage
  shared/                   middleware (auth, validate, upload), utils (response, errors, time), constants
  modules/<name>/           <name>.routes|controller|service|repository|schema|dto.ts (+ tests)
  evals/                    scenarios.ts, run-evals.ts
prisma/schema.prisma, prisma/migrations/
```
**Key modules:** `assistant` (chat with actions, memory, patterns), `guide` (today's one thing, saves → action),
`activity` (event log + undo), `task`, `habit`, `area`, `goal`, `project`, `settings`. Older modules (`capture`, `vault`,
`knowledge`, `document`, `decisions`, …) still exist. Don't extend them unless the plan says so.

## Conventions (follow these when adding code)
- **Route → controller → service → repository.** Controllers stay thin. Validate input with Zod via
  `validate(schema)` / `validateQuery(schema)`. Respond with `sendSuccess(res, message, data, status?)`.
  Throw `ValidationError` (422), `NotFoundError` (404), `ForbiddenError`, `ConflictError` from `shared/utils/errors.util.ts`.
- **Scope every query by `userId`** (`where: { id, userId }`). Never trust ids from the client or the AI without checking ownership.
- **Record history:** any user-visible action calls `recordActivity(userId, { type, itemType, itemId, title, source, undo })`
  from `modules/activity/activity.service.ts`, with an `undo` payload when reversible. Return `activityId` to the client so it can offer Undo.
  To add a new reversible action, add a payload kind to `UndoPayload` and handle it in `applyUndo`.
- **AI rules (ADR 0004):** use `runWithAiFallback(label, { gemini, groq }, heuristic)`. Ask for JSON, validate every field,
  check ids against the user's data, and always provide a heuristic fallback. Settings, safety, timing and ordering
  are deterministic code; the AI only picks from shortlists, writes words, parses and summarises.
- **Product rules:** no streak/guilt language; nothing is sent to the user unprompted (ADR 0006); new needs map to the 6 blocks (ADR 0003).
- Comments explain *why*, in the existing style (short block comments above non-obvious code).
- Time: user-local days via `shared/utils/time.util.ts` (`todayKeyInTz`, `dateFromKey`, `localDayStartMs`). Default tz `Asia/Kolkata`.

## Database / migrations
Production Neon is the only working DB. Migrations are additive and generated **offline**. Follow
`docs/runbooks/migrations.md` exactly (no `DROP`; enum additions and data backfills go in separate migrations; count rows before and after).

## Testing
- Unit tests for pure logic (`*.test.ts`), integration tests for the full request cycle (`*.integration.test.ts`).
- Integration tests and evals run against Neon via a temporary Vitest config (`docs/runbooks/testing.md`).
  Each test registers a `…@test.local` user and **deletes it in `afterAll`**.
- New scenario coverage goes in `src/evals/scenarios.ts` (flip `status` to `"ready"` and add `run`).

## Env (`.env`, never commit)
`DATABASE_URL`, `JWT_SECRET`, `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `PREFERRED_AI_PROVIDER` (`gemini` | `groq`).

## Gotchas
- Gemini model ids get retired. Set `GEMINI_MODEL` (default `gemini-3.5-flash-lite`). Bigger flash models often 503 on the free tier.
- Groq free tier: 200k tokens/day. Heavy eval runs exhaust it, and chat then returns `usedAi: false`.
- Render free plan sleeps (~50 s first request). Deploys are manual (`docs/runbooks/deploy.md`).
- Don't write regexes through bash heredocs (`\b` becomes a backspace byte). Use file edit tools.
