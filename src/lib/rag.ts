/* =====================================================================
   RAG (Retrieval-Augmented Generation) context builder.

   Fetches a lightweight snapshot of the user's key entities and formats
   them for injection into Gemini prompts. Both the capture classifier and
   the decision engine call this so the AI knows the user's actual areas,
   goals, and topics — not just generic categories.
   ===================================================================== */
import prisma from "./prisma.js"
import { dayKeyInTz, timeOfDayLabel, weekdayInTz } from "../shared/utils/time.util.js"

// The "right now" the AI reasons over — same idea as the decisions engine's
// schedule/timeOfDay, but lightweight so every AI call site (not just the
// dashboard) can resolve relative dates ("tomorrow", "tonight") and adapt
// tone to the moment, in the user's own timezone rather than server UTC.
export interface RagNow {
  isoDate: string // "YYYY-MM-DD" in the user's timezone — the anchor for relative-date parsing
  weekday: string // "Monday"
  timeOfDay: string // "morning" | "afternoon" | "evening" | "night"
  timezone: string
}

export interface UserRagContext {
  areas: { id: string; name: string; type: string }[]
  goals: { id: string; title: string; areaId: string | null }[]
  topics: { id: string; title: string; areaId: string }[]
  now: RagNow
}

// Resolves the user's "right now" (in their own timezone). Split out so AI call
// sites that only need the clock — e.g. document Q&A — can skip the areas/goals/
// topics queries the full context builder runs.
export const getUserNow = async (userId: string): Promise<RagNow> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  })
  const timezone = user?.timezone ?? "UTC"
  const instant = new Date()
  return {
    isoDate: dayKeyInTz(instant, timezone),
    weekday: weekdayInTz(timezone, instant),
    timeOfDay: timeOfDayLabel(timezone, instant),
    timezone,
  }
}

/** Fetches a compact user context snapshot in 4 parallel queries. */
export const getUserRagContext = async (userId: string): Promise<UserRagContext> => {
  const [areas, goals, topics, now] = await Promise.all([
    prisma.area.findMany({
      where: { userId, isActive: true },
      select: { id: true, name: true, type: true },
      orderBy: { order: "asc" },
    }),
    prisma.goal.findMany({
      where: { userId, status: { not: "COMPLETED" } },
      select: { id: true, title: true, areaId: true },
      take: 20,
    }),
    prisma.topic.findMany({
      where: { userId },
      select: { id: true, title: true, areaId: true },
      take: 30,
    }),
    getUserNow(userId),
  ])
  return { areas, goals, topics, now }
}

/** Formats the context as a plain-text block for Gemini system prompts. */
export const formatRagContextForPrompt = (ctx: UserRagContext): string => {
  const areasList = ctx.areas.length
    ? ctx.areas.map((a) => `  - "${a.name}" (id: ${a.id})`).join("\n")
    : "  (none yet)"

  const goalsList = ctx.goals.length
    ? ctx.goals.map((g) => `  - "${g.title}" (areaId: ${g.areaId ?? "none"})`).join("\n")
    : "  (none yet)"

  const topicsList = ctx.topics.length
    ? ctx.topics.map((t) => `  - "${t.title}" (id: ${t.id}, areaId: ${t.areaId})`).join("\n")
    : "  (none yet)"

  return [
    `Current date/time: ${ctx.now.isoDate} (${ctx.now.weekday}), ${ctx.now.timeOfDay}, timezone ${ctx.now.timezone}. Use this as "today" when resolving relative dates.`,
    "User's life areas:",
    areasList,
    "Active goals:",
    goalsList,
    "Learning topics:",
    topicsList,
  ].join("\n")
}
