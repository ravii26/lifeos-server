# LifeOS Server — Complete Project Context

> **Purpose of this file:** Drop this into any new Claude session as the first message (use the prompt at the very bottom). The model will have full context without needing the chat history. Keep this file updated every session.
>
> **Last updated:** 2026-06-17

---

## 1. What Is LifeOS

A personal operating system app for a single user (Ravindra). The backend is a Node/Express REST API. The frontend (separate repo, not tracked here) is a React Native or web app. The core idea: one place that manages tasks, habits, goals, learning resources, vault (saved motivations/memories), a "brain dump" capture inbox, and periodic reviews — all tied together with an AI triage layer powered by Gemini.

**Stack:**
- Runtime: Node.js (ESM, `"type": "module"`)
- Framework: Express 5
- ORM: Prisma + PostgreSQL (local, `lifeos_db`)
- Language: TypeScript (strict)
- Auth: JWT (jsonwebtoken + bcryptjs)
- AI: Google Gemini (`@google/generative-ai`, model `gemini-2.0-flash`)
- Logging: Winston
- Validation: Zod v4

---

## 2. Folder Structure

```
lifeos-server/
├── prisma/
│   ├── schema.prisma              ← single source of truth for DB
│   └── migrations/                ← auto-generated, never edit manually
├── src/
│   ├── index.ts                   ← server entry point (starts Express)
│   ├── app.ts                     ← Express app setup (middleware, router mount)
│   ├── config/
│   │   └── env.config.ts          ← Zod-validated env vars, exported as `env`
│   ├── lib/
│   │   ├── prisma.ts              ← singleton PrismaClient
│   │   ├── gemini.ts              ← GoogleGenerativeAI client (null if no API key)
│   │   └── logger.ts              ← Winston logger
│   ├── shared/
│   │   ├── constants/
│   │   │   └── httpStatus.ts      ← HttpStatus enum
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts ← JWT verify, attaches req.user
│   │   │   ├── error.middleware.ts← global error handler
│   │   │   └── validate.middleware.ts ← Zod body/query validators
│   │   └── utils/
│   │       ├── errors.util.ts     ← NotFoundError, ValidationError, etc.
│   │       └── response.util.ts   ← sendSuccess / sendError helpers
│   └── modules/
│       ├── index.ts               ← route aggregator (all modules registered here)
│       ├── auth/                  ← register, login, /me, /stats
│       ├── identity/              ← user identity/profile (personality, values, vision)
│       ├── area/                  ← life areas with live scoring + snapshot history
│       ├── goal/                  ← goals per area
│       ├── project/               ← projects per area/goal
│       ├── task/                  ← tasks with source tracking
│       ├── habit/                 ← habits + daily logs + streaks/stats
│       ├── vault/                 ← vault items (motivation, memory, recovery, reflection)
│       ├── topic/                 ← learning topics per area
│       ├── notebook/              ← notebooks per topic
│       ├── resource/              ← learning resources with progress tracking
│       ├── note/                  ← notes per topic/notebook/resource
│       ├── review/                ← periodic reviews + insight reviews
│       ├── calendar/              ← calendar blocks
│       ├── focus/                 ← focus sessions
│       ├── behavior/              ← behavior event log (analytics)
│       ├── capture/               ← brain-dump inbox with AI triage (Gemini)
│       └── settings/              ← UI personalisation settings (vibe, accent, font)
```

### Module file convention (every module follows this exact pattern)

```
module/
  module.schema.ts   ← Zod schemas + inferred DTO types
  module.dto.ts      ← Response types (what the API sends back)
  module.repository.ts ← All Prisma calls live here only
  module.service.ts  ← Business logic; calls repository; throws typed errors
  module.controller.ts ← Express handlers; calls service; calls sendSuccess
  module.routes.ts   ← Router; wires validate middleware + controller
```

**When `schema.ts`/`dto.ts` are required:** any route that accepts a request body or
query params must validate it with a Zod schema in `module.schema.ts` — always, no
exceptions. GET-only modules with no params to validate (`decisions`, `graph`) skip
`schema.ts`/`dto.ts` — there is nothing to validate and no request shape to type, so the
files would be empty boilerplate. The moment either module grows a param (e.g.
`GET /decisions/now?horizon=week`), add `module.schema.ts` for it at that point, not
before.

---

## 3. Environment Variables

File: `.env` (not committed)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | — | JWT signing secret |
| `PORT` | ❌ | `3000` | Server port |
| `NODE_ENV` | ❌ | `development` | `development\|production\|test` |
| `GEMINI_API_KEY` | ❌ | — | Google Gemini API key. If absent, capture classifier falls back to keyword heuristic — server works fully without it |

---

## 4. Database Schema Summary

> Full schema: `prisma/schema.prisma`

| Model | Key fields | Notes |
|---|---|---|
| `User` | id, email, passwordHash, name, timezone | Root entity |
| `Identity` | personality, values[], strengths[], weaknesses[], purpose, thisYearGoal, bigPicture, lifeVision | One-to-one with User |
| `UserSettings` | vibe, accent, font, startTab | One-to-one with User; upserted on first PATCH |
| `Area` | name, type(PRIMARY\|MAINTENANCE), color, icon, order, isActive | Belongs to User |
| `AreaScoreSnapshot` | areaId, score, tasksDone, tasksTotal, streak, focusMins, snapshotAt | Append-only history; triggered by POST /areas/:id/snapshot |
| `Goal` | title, priority, status, deadline | Belongs to User + Area |
| `Project` | title, status, deadline | Belongs to User + Area + optional Goal |
| `Task` | title, status, priority, taskType, targetCount, completedCount, targetMinutes, dueDate, isRecurring, recurrence, source(MANUAL\|DUMP\|LEARN), sourceId | Belongs to User; optional Area/Goal/Project |
| `Habit` | title, habitType, targetCount, targetMinutes, frequency, weeklyTarget, specificDays[], reminderTime, isActive | Belongs to User + Area |
| `HabitLog` | date(Date), completed, count, minutes, notes | Belongs to Habit; unique(habitId, date) |
| `Topic` | title, masteryLevel(BEGINNER\|INTERMEDIATE\|ADVANCED\|EXPERT) | Belongs to User + Area |
| `Notebook` | title, tags[] | Belongs to User + Topic |
| `Resource` | title, resourceType, url, platform, status, rating, notes, **totalLessons**, **lessonsCompleted**, **minutesConsumed** | Belongs to User + Topic |
| `Note` | title, content, noteType, tags[] | Belongs to User + Topic; optional Notebook + Resource |
| `VaultItem` | title, content, vaultType, mediaType, url, triggerTags[], usedCount, helpfulCount | Belongs to User |
| `Capture` | rawText, detectedUrl, suggestedOutputs(JSON), createdOutputs(JSON), status(PENDING\|CONVERTED\|DISMISSED), confidence, worthCheck, worthReason | Belongs to User |
| `Review` | reviewType, periodStart, periodEnd, summary, highlights, improvements, aiInsights(JSON) | Belongs to User |
| `InsightReview` | status(PENDING\|IMPLEMENTED\|STILL_WORKING\|NOT_APPLICABLE), userNote | Bridges Review + Note |
| `BehaviorLog` | eventType, metadata(JSON), occurredAt | Append-only analytics |
| `CalendarBlock` | title, startTime, endTime, blockType, isActual | Optional Task/Habit/Area link |
| `FocusSession` | startedAt, endedAt, durationMinutes | Optional Task/Habit/CalendarBlock link |

### Enums
`AreaType`, `Priority`, `GoalStatus`, `ProjectStatus`, `TaskStatus`, `TaskType`, `TaskSource`, `Recurrence`, `HabitType`, `HabitFrequency`, `MasteryLevel`, `ResourceType`, `ResourceStatus`, `NoteType`, `VaultType`, `MediaType`, `CaptureStatus`, `WorthCheck`, `ReviewType`, `InsightReviewStatus`, `BehaviorEvent`

---

## 5. Complete API Reference

Base path: `/api/v1`  
All protected routes require: `Authorization: Bearer <jwt>`

### Auth — `/auth`
| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| POST | `/auth/register` | ❌ | `{ name, email, password }` | `{ token, user }` |
| POST | `/auth/login` | ❌ | `{ email, password }` | `{ token, user }` |
| GET | `/auth/me` | ✅ | — | User object |
| GET | `/auth/stats` | ✅ | — | `{ joinedAt, tasksDone, habitsLogged, focusHours }` |

### Identity — `/identity`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/identity` | ✅ | Returns identity or null |
| POST | `/identity` | ✅ | Create identity |
| PATCH | `/identity` | ✅ | Update any identity fields |
| DELETE | `/identity` | ✅ | Delete identity |

### Settings — `/settings` *(B9 — NEW)*
| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| GET | `/settings` | ✅ | — | Returns DB row or in-memory defaults |
| PATCH | `/settings` | ✅ | `{ vibe?, accent?, font?, startTab? }` | Upserts (creates on first call) |

Fields: `vibe`: `calm\|focused\|energetic` · `accent`: hex `#rrggbb` · `font`: `inter\|mono\|serif` · `startTab`: `today\|areas\|dump`

### Areas — `/areas`
| Method | Path | Auth | Body / Query | Notes |
|---|---|---|---|---|
| POST | `/areas` | ✅ | `{ name, type?, color, icon, order?, isDefault?, isActive? }` | |
| GET | `/areas` | ✅ | — | Returns areas **with live score** (score, tasksDone, tasksTotal, streak, focusMins) |
| GET | `/areas/:id` | ✅ | — | Single area (no score) |
| PATCH | `/areas/:id` | ✅ | Partial area fields | |
| DELETE | `/areas/:id` | ✅ | — | |
| POST | `/areas/:id/snapshot` | ✅ | — | **A3** Computes live score and persists to AreaScoreSnapshot |
| GET | `/areas/:id/snapshots` | ✅ | `?limit=30` | **A3** Returns score history newest-first |

**Area score formula:** `0.4·taskCompletion + 0.4·habitConsistency(7d) + 0.2·learningFraction`  
Baselines for empty areas: task=0.5, habit=0.5, learning=0.4 (so brand-new areas show ~50%, not 0%)

### Goals — `/goals`
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/goals` | ✅ | `{ title, areaId, priority?, status?, deadline?, description? }` |
| GET | `/goals` | ✅ | `?areaId=` |
| GET | `/goals/:id` | ✅ | |
| PATCH | `/goals/:id` | ✅ | Partial goal fields |
| DELETE | `/goals/:id` | ✅ | |

### Projects — `/projects`
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/projects` | ✅ | `{ title, areaId, goalId?, description?, status?, deadline? }` |
| GET | `/projects` | ✅ | `?areaId=&goalId=` |
| GET | `/projects/:id` | ✅ | |
| PATCH | `/projects/:id` | ✅ | Partial project fields |
| DELETE | `/projects/:id` | ✅ | |

### Tasks — `/tasks`
| Method | Path | Auth | Body / Query | Notes |
|---|---|---|---|---|
| POST | `/tasks` | ✅ | `{ title, areaId?, goalId?, projectId?, priority?, taskType?, targetCount?, targetMinutes?, dueDate?, isRecurring?, recurrence?, **source?**, **sourceId?** }` | source: MANUAL\|DUMP\|LEARN |
| GET | `/tasks` | ✅ | `?areaId=&status=&priority=&dueDate=` | |
| GET | `/tasks/:id` | ✅ | | |
| PATCH | `/tasks/:id` | ✅ | Partial task fields | |
| PATCH | `/tasks/:id/complete` | ✅ | — | Marks COMPLETED, stamps completedAt, fires TASK_COMPLETED behavior |
| DELETE | `/tasks/:id` | ✅ | | |

### Habits — `/habits`
| Method | Path | Auth | Body / Query | Notes |
|---|---|---|---|---|
| POST | `/habits` | ✅ | `{ title, areaId, habitType?, targetCount?, targetMinutes?, frequency?, weeklyTarget?, specificDays?, reminderTime? }` | |
| GET | `/habits` | ✅ | `?areaId=&isActive=` | **B4** Returns with stats: `currentStreak`, `longestStreak`, `todayDone`, `todayLog`, `history[28]` |
| GET | `/habits/:id` | ✅ | | Single habit (no stats) |
| PATCH | `/habits/:id` | ✅ | Partial habit fields | |
| DELETE | `/habits/:id` | ✅ | | |
| POST | `/habits/:id/log` | ✅ | `{ date?, completed, count?, minutes?, notes? }` | Upserts log for date; fires HABIT_LOGGED |
| GET | `/habits/:id/logs` | ✅ | `?from=&to=&limit=` | Date-range filtered |

### Vault — `/vault`
| Method | Path | Auth | Body / Query | Notes |
|---|---|---|---|---|
| POST | `/vault` | ✅ | `{ title, content, vaultType, mediaType?, url?, triggerTags? }` | |
| GET | `/vault` | ✅ | `?vaultType=&mediaType=` | |
| GET | `/vault/:id` | ✅ | | |
| PATCH | `/vault/:id` | ✅ | Partial vault fields | |
| POST | `/vault/:id/used` | ✅ | — | **B7** Atomically increments usedCount; fires VAULT_ACCESSED |
| DELETE | `/vault/:id` | ✅ | | |

### Topics — `/topics`
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/topics` | ✅ | `{ title, areaId, description?, masteryLevel? }` |
| GET | `/topics` | ✅ | `?areaId=` |
| GET | `/topics/:id` | ✅ | |
| PATCH | `/topics/:id` | ✅ | Partial topic fields |
| DELETE | `/topics/:id` | ✅ | |

### Notebooks — `/notebooks`
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/notebooks` | ✅ | `{ title, topicId, description?, tags? }` |
| GET | `/notebooks` | ✅ | `?topicId=` |
| GET | `/notebooks/:id` | ✅ | |
| PATCH | `/notebooks/:id` | ✅ | Partial notebook fields |
| DELETE | `/notebooks/:id` | ✅ | |

### Resources — `/resources`
| Method | Path | Auth | Body / Query | Notes |
|---|---|---|---|---|
| POST | `/resources` | ✅ | `{ title, topicId, resourceType, url?, platform?, status?, rating?, notes? }` | |
| GET | `/resources` | ✅ | `?topicId=&resourceType=&status=` | |
| GET | `/resources/:id` | ✅ | | |
| PATCH | `/resources/:id` | ✅ | Partial resource fields | |
| PATCH | `/resources/:id/progress` | ✅ | `{ lessonsCompleted?, totalLessons?, minutesConsumed?, autoComplete? }` | **B8** minutesConsumed is cumulative (added to existing). autoComplete=true auto-sets status=COMPLETED when lessons done |
| DELETE | `/resources/:id` | ✅ | | |

### Notes — `/notes`
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/notes` | ✅ | `{ title, content, topicId, notebookId?, resourceId?, noteType?, tags? }` |
| GET | `/notes` | ✅ | `?topicId=&notebookId=&resourceId=&noteType=` |
| GET | `/notes/:id` | ✅ | |
| PATCH | `/notes/:id` | ✅ | Partial note fields |
| DELETE | `/notes/:id` | ✅ | |

### Reviews — `/reviews`
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/reviews` | ✅ | `{ reviewType, periodStart, periodEnd, summary?, highlights?, improvements?, userNote?, aiInsights? }` |
| GET | `/reviews` | ✅ | `?reviewType=` |
| GET | `/reviews/:id` | ✅ | |
| PATCH | `/reviews/:id` | ✅ | Partial review fields |
| DELETE | `/reviews/:id` | ✅ | |
| POST | `/reviews/:id/insights` | ✅ | `{ noteId, userNote? }` | Create InsightReview |
| GET | `/reviews/:id/insights` | ✅ | | List insights for a review |
| PATCH | `/reviews/insights/:insightId` | ✅ | `{ status?, userNote? }` | Update insight status |
| DELETE | `/reviews/insights/:insightId` | ✅ | | |

### Calendar — `/calendar`
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/calendar` | ✅ | `{ title, startTime, endTime, blockType?, taskId?, habitId?, areaId?, isActual?, notes? }` |
| GET | `/calendar` | ✅ | `?from=&to=&areaId=` |
| GET | `/calendar/:id` | ✅ | |
| PATCH | `/calendar/:id` | ✅ | Partial block fields |
| DELETE | `/calendar/:id` | ✅ | |

### Focus — `/focus`
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/focus` | ✅ | `{ startedAt, taskId?, habitId?, calendarBlockId? }` | Fires FOCUS_STARTED |
| GET | `/focus` | ✅ | `?taskId=&habitId=&from=&to=` |
| GET | `/focus/:id` | ✅ | |
| PATCH | `/focus/:id/stop` | ✅ | `{ endedAt?, notes? }` | Sets endedAt + durationMinutes; fires FOCUS_COMPLETED |
| PATCH | `/focus/:id` | ✅ | `{ notes? }` | General update |
| DELETE | `/focus/:id` | ✅ | |

### Behavior — `/behavior`
| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/behavior` | ✅ | `{ eventType, metadata? }` | Manual event log |
| GET | `/behavior` | ✅ | `?eventType=&limit=` | |

**Auto-fired events** (never call manually from frontend for these):
- `CAPTURE_CREATED` — on POST /captures
- `TASK_COMPLETED` — on PATCH /tasks/:id/complete
- `HABIT_LOGGED` — on POST /habits/:id/log
- `VAULT_ACCESSED` — on POST /vault/:id/used
- `FOCUS_STARTED` — on POST /focus
- `FOCUS_COMPLETED` — on PATCH /focus/:id/stop

### Captures — `/captures` *(A1 — the Brain Dump inbox)*
| Method | Path | Auth | Body / Query | Notes |
|---|---|---|---|---|
| POST | `/captures` | ✅ | `{ text }` | Classifies via Gemini (or heuristic); saves PENDING; fires CAPTURE_CREATED |
| GET | `/captures` | ✅ | `?processed=false\|true` | `processed=false` → inbox (PENDING only) |
| PATCH | `/captures/:id` | ✅ | `{ type }` | Override AI's guess before converting |
| POST | `/captures/:id/convert` | ✅ | `{ areaId?, topicId?, priority? }` | **Hero step**: creates real entity, marks CONVERTED |
| DELETE | `/captures/:id` | ✅ | — | Dismiss |

**Capture → convert rules:**
- `TASK`: areaId optional
- `HABIT`: areaId **required** (422 if missing)
- `NOTE`: topicId **required** (422 if missing)
- `RESOURCE`: topicId **required** (422 if missing)
- `VAULT`: no parent required

**Capture response shape:**
```json
{
  "id": "...",
  "text": "raw brain dump",
  "type": "TASK|HABIT|NOTE|RESOURCE|VAULT",
  "confidence": 0.87,
  "processed": false,
  "status": "PENDING|CONVERTED|DISMISSED",
  "meta": { "priority": "MEDIUM" },
  "detectedUrl": null,
  "createdOutput": null,
  "createdAt": "..."
}
```

**Convert response shape:**
```json
{
  "capture": { ...captureDto, "status": "CONVERTED" },
  "created": { "type": "TASK", "entity": { ...taskObject } }
}
```

---

## 6. AI Classifier (Gemini)

**File:** `src/modules/capture/capture.ai.ts`

`classifyCapture(text)` → `Promise<{ type, confidence, meta }>`

- When `GEMINI_API_KEY` is set: calls `gemini-2.0-flash` with `responseMimeType: "application/json"`. Sends a system prompt instructing the model to return `{ type, confidence, reasoning, meta }`.
- When key is absent or Gemini throws: falls back to keyword heuristic (no latency, no cost).
- The fallback is silent — callers never know which path was taken.

**To activate Gemini:** add `GEMINI_API_KEY=AIza...` to `.env`. No code changes needed.

**To upgrade the model or improve the prompt:** only change `capture.ai.ts` — nothing else in the module needs to change (the seam is intentionally tiny).

---

## 7. Area Scoring (A2)

**File:** `src/modules/area/area.scoring.ts`

Pure function: `scoreArea(areaId, { tasks, habits, resources }) → { score, tasksDone, tasksTotal, streak, focusMins }`

Computed on every `GET /areas` call (3 flat queries, no N+1):
- `taskCompletion` = completed / total tasks for the area (baseline 0.5 if no tasks)
- `habitConsistency` = avg 7-day completion rate across all area habits (baseline 0.5)
- `learningFraction` = completed resources / total resources for the area (baseline 0.4)
- `score` = round((0.4·task + 0.4·habit + 0.2·learn) × 100)

Also returns: `streak` (best current habit streak in the area), `focusMins` (habit minutes logged today)

---

## 8. Habit Stats (B4)

**File:** `src/modules/habit/habit.stats.ts`

`computeHabitStats(logs, windowDays) → { currentStreak, longestStreak, history[] }`

- Returned inline in `GET /habits` list response
- 28-day `history[]` boolean array (index 0 = today)
- `todayDone` / `todayLog` also included per habit

---

## 9. Completed Features Checklist

| ID | Feature | Status |
|---|---|---|
| A1 | Capture / Brain-Dump inbox module | ✅ Complete |
| — | RAG context layer (`src/lib/rag.ts`) | ✅ Complete |
| — | Smart Capture AI (RAG + richer meta + suggestedAreaId/TopicId + worthCheck) | ✅ Complete |
| — | Smart Convert (uses AI suggestions as fallback parents) | ✅ Complete |
| — | Area Trends (`GET /areas/trends`) | ✅ Complete |
| — | Decision Engine v2 (actionableSteps, streakAlerts, weeklyPattern) | ✅ Complete |
| — | Personal Knowledge Graph (`GET /graph`) | ✅ Complete |
| A2 | Area live scoring (returned in GET /areas) | ✅ Complete |
| A3 | Area score snapshot history | ✅ Complete |
| B4 | Habit stats inline in list (streak, history) | ✅ Complete |
| B6 | Task source/sourceId (Note→Task provenance) | ✅ Complete |
| B7 | Vault usedCount increment endpoint | ✅ Complete |
| B8 | Resource lesson/minute progress tracking | ✅ Complete |
| B9 | User settings (vibe, accent, font, startTab) | ✅ Complete |
| B10 | Auth /stats lifetime profile stats | ✅ Complete |
| — | All 17 core CRUD modules | ✅ Complete |
| — | JWT auth middleware | ✅ Complete |
| — | Global error handler | ✅ Complete |
| — | Zod validation middleware | ✅ Complete |
| — | Behavior event auto-logging | ✅ Complete |
| — | Gemini AI classifier with heuristic fallback | ✅ Complete |

---

### Graph — `/graph`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/graph` | ✅ | Returns `{ nodes[], edges[], counts, generatedAt }` — all entities as a knowledge graph |

**Node types:** `AREA · GOAL · PROJECT · TASK · HABIT · TOPIC · NOTEBOOK · NOTE`
**Edge types:** `AREA_GOAL · AREA_HABIT · AREA_TOPIC · GOAL_PROJECT · PROJECT_TASK · AREA_TASK · TOPIC_NOTEBOOK · TOPIC_NOTE`
Tasks and notes are capped at 50 each (newest first) to keep the graph renderable.

### Area Trends — `/areas/trends`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/areas/trends` | ✅ | Returns per-area score trend: `{ areaId, areaName, currentScore, previousScore, delta, direction: UP\|STABLE\|DOWN, snapshotCount, weakness }` + `overallDirection` |

Requires at least 2 snapshots per area (via `POST /areas/:id/snapshot`) to show meaningful deltas. `weakness` is the lowest-scoring driver (task completion, habit consistency, or learning progress).

---

## 10. What Is NOT Yet Built (Deferred)

| ID | Feature | Why deferred | What it needs |
|---|---|---|---|
| — | Weekly/daily review AI generation | No AI review writer yet | Gemini call that reads all tasks/habits/notes for the period and writes `aiInsights` JSON |
| — | Push notifications / reminders | No notification service | Firebase FCM or Expo push; needs device token storage |
| — | Goal progress auto-calculation | Goals have no computed % | Would need to aggregate linked tasks/projects |
| — | Capture `worthCheck` / `worthReason` | Fields exist in DB, not used | Gemini should return this; currently ignored |
| — | Capture `suggestedOutputs` richer data | Gemini returns `reasoning` but it's not stored | Minor: store reasoning in `worthReason` column |
| — | `InsightReview` auto-creation on review | Manual only | Review generation job that links recent notes |
| — | Rate limiting per user | Only global rate limit exists | Per-user limiter on expensive AI routes |
| — | Test suite | No tests at all | Vitest + supertest; DB testcontainers |

---

## 11. Key Conventions (Follow These Exactly)

### Error handling
- Throw `NotFoundError("message")` for 404s — the global handler maps it to 404
- Throw `ValidationError("message")` for 422s
- Never call `res.status(x).json(...)` in a service — only in controllers via `sendSuccess`

### Ownership checks
Every by-id service operation does `getOwned<Entity>` first — finds by `{ id, userId }` and throws `NotFoundError` if missing. This pattern prevents users from touching each other's data by guessing IDs.

### Repository layer
- All Prisma calls live in `*.repository.ts` only
- Services never import `prisma` directly
- Repositories return raw Prisma types; DTOs are shaped in the service or controller

### Response format
All responses go through `sendSuccess(res, message, data?, status?)`:
```json
{ "success": true, "message": "...", "data": {...} }
```

### Route aggregator
`src/modules/index.ts` is the only file that grows when a new module is added. `app.ts` never changes.

### Behavior logging
`logBehavior(userId, eventType, metadata?)` — fire-and-forget (no await). Always call after the main DB write succeeds.

### Imports
All internal imports use `.js` extension (ESM interop). Example:
```ts
import { sendSuccess } from "../../shared/utils/response.util.js"
```

---

## 12. How to Run

```bash
# Install
npm install

# DB
npx prisma migrate dev     # run pending migrations
npx prisma studio          # optional: GUI

# Dev server (hot reload)
npm run dev

# Typecheck
npx tsc --noEmit

# Build
npm run build
```

**To activate Gemini AI:** add to `.env`:
```
GEMINI_API_KEY=AIzaSy...your_key_here
```

---

## 13. Migrations Applied

| Migration | What it added |
|---|---|
| `20260616232321_add_settings_snapshots_resource_progress` | `UserSettings` table, `AreaScoreSnapshot` table, `Resource.lessonsCompleted/totalLessons/minutesConsumed` columns |

All prior schema was set up in the initial commit.

---

*— End of context file. Updated automatically at the end of each Claude session via the Stop hook in `.claude/settings.json`.*

---

## Session Log

<!-- Entries are prepended by Claude at the end of each session. Newest first. -->

### 2026-06-17 (session 2)
- **RAG Context Layer** (`src/lib/rag.ts`): `getUserRagContext(userId)` fetches areas+goals+topics in 3 parallel queries; `formatRagContextForPrompt()` formats for Gemini system prompts. Used by capture AI and can be used by any future AI feature.
- **Smart Capture AI** (`capture.ai.ts`): Gemini now receives full user context (areas, goals, topics) so it can suggest `suggestedAreaId`, `suggestedTopicId`. Also extracts: `title` (cleaned-up, not raw dump), `dueDate`, `frequency`, `targetMinutes`, `platform`, `resourceType`, `worthCheck`, `worthReason`. Fixed wrong model name (`gemini-3.5-flash` → `gemini-2.0-flash`). Heuristic also does basic name-matching against user's areas/topics.
- **Smart Convert** (`capture.service.ts`): `convertCaptureService` now uses `meta.suggestedAreaId` / `meta.suggestedTopicId` as fallback when user doesn't pass `areaId`/`topicId`. HABIT and RESOURCE still require an area/topic but can now resolve from AI suggestion automatically. Titles use `meta.title` (AI-cleaned) instead of raw text.
- **Area Trends** (`GET /areas/trends`): Returns per-area `{ direction: UP|STABLE|DOWN, delta, currentScore, previousScore, weakness }`. `weakness` identifies the lowest-scoring driver (task/habit/learning). Requires at least 2 snapshots per area to show deltas.
- **Decision Engine v2** (`decisions.ai.ts`): Each suggestion now has `actionableSteps[]` (1-3 micro-actions). Added `streakAlerts[]` (habits with streaks ≥ 3 at risk today) and `weeklyPattern` (e.g. "Most active on Mon; least on Sun"). Habits sorted by streak length (highest-risk first). Heuristic fallback also improved.
- **Personal Knowledge Graph** (`GET /graph`): New `src/modules/graph/` module. Returns nodes (AREA/GOAL/PROJECT/TASK/HABIT/TOPIC/NOTEBOOK/NOTE) + typed edges. Tasks/notes capped at 50 newest. Wired into `/api/v1/graph`.

### 2026-06-17
- Added **Decision Engine** module (`src/modules/decisions/`) with `GET /decisions/now` — assembles area scores, pending tasks, habits not done today, active goals, and 7-day behavior logs, then calls Gemini 2.0 Flash for ranked suggestions + neglected area insight + today focus + behavior pattern. Falls back to deterministic heuristic if no API key or Gemini fails.
- Added **auto-convert captures**: when `confidence ≥ 0.85` and type is `TASK` or `VAULT`, `POST /captures` now silently converts the capture in the background (fire-and-forget). Types that need parent IDs (HABIT, NOTE, RESOURCE) stay PENDING.
- Fixed **midnight bug** in `area.scoring.ts`: `todayKey` was a module-level constant (frozen at server start). Moved inside `scoreArea()` so it recomputes on every call.
- Updated `md_files/HANDOFF.md` with the full list of modules added in the previous session (Capture, Area scoring, Habit stats, Settings, Resource progress) and new next steps.
- Added `## Session Log` section to this file; updated closing note.

