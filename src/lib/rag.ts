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

/* =====================================================================
   Life context — a richer snapshot (adds Habits/Tasks/Resources) used by
   surfaces that should be able to answer questions about the user's actual
   state ("what are my goals in Fitness?", "what habits am I behind on?")
   without requiring any uploaded material. Areas are resolved to names so
   the answer text can name them directly instead of leaking internal ids.
   ===================================================================== */
export interface UserLifeContext {
  areas: { id: string; name: string; type: string }[]
  goals: { id: string; title: string; status: string; areaName: string | null; deadline: Date | null }[]
  habits: { id: string; title: string; frequency: string; areaName: string | null }[]
  tasks: {
    id: string
    title: string
    status: string
    priority: string
    dueDate: Date | null
    areaName: string | null
  }[]
  // Learn topics — e.g. "System Design" — surfaced even before any resource
  // or note has been added under them, so a bare topic is still answerable.
  topics: { id: string; title: string; masteryLevel: string; areaName: string | null }[]
  resources: { id: string; title: string; status: string; topicTitle: string; areaName: string | null }[]
  now: RagNow
}

export const isLifeContextEmpty = (ctx: UserLifeContext): boolean =>
  ctx.areas.length === 0 &&
  ctx.goals.length === 0 &&
  ctx.habits.length === 0 &&
  ctx.tasks.length === 0 &&
  ctx.topics.length === 0 &&
  ctx.resources.length === 0

/** Fetches Areas/Goals/Habits/Tasks/Topics+Resources (Learn) in parallel. */
export const getUserLifeContext = async (userId: string): Promise<UserLifeContext> => {
  const [areas, goals, habits, tasks, topics, resources, now] = await Promise.all([
    prisma.area.findMany({
      where: { userId, isActive: true },
      select: { id: true, name: true, type: true },
      orderBy: { order: "asc" },
    }),
    prisma.goal.findMany({
      where: { userId, status: { not: "COMPLETED" } },
      select: { id: true, title: true, status: true, areaId: true, deadline: true },
      take: 30,
    }),
    prisma.habit.findMany({
      where: { userId, isActive: true },
      select: { id: true, title: true, frequency: true, areaId: true },
      take: 40,
    }),
    prisma.task.findMany({
      where: { userId, status: { in: ["TODO", "IN_PROGRESS"] } },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, status: true, priority: true, dueDate: true, areaId: true },
      take: 50,
    }),
    prisma.topic.findMany({
      where: { userId },
      select: { id: true, title: true, masteryLevel: true, areaId: true },
      take: 40,
    }),
    prisma.resource.findMany({
      where: { userId, status: { not: "COMPLETED" } },
      select: {
        id: true,
        title: true,
        status: true,
        topic: { select: { title: true, areaId: true } },
      },
      take: 30,
    }),
    getUserNow(userId),
  ])

  const areaName = new Map(areas.map((a) => [a.id, a.name]))

  return {
    areas,
    goals: goals.map((g) => ({ ...g, areaName: areaName.get(g.areaId) ?? null })),
    habits: habits.map((h) => ({ ...h, areaName: areaName.get(h.areaId) ?? null })),
    tasks: tasks.map((t) => ({ ...t, areaName: t.areaId ? areaName.get(t.areaId) ?? null : null })),
    topics: topics.map((t) => ({ ...t, areaName: areaName.get(t.areaId) ?? null })),
    resources: resources.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      topicTitle: r.topic.title,
      areaName: r.topic.areaId ? areaName.get(r.topic.areaId) ?? null : null,
    })),
    now,
  }
}

/** Formats the life context as a plain-text block for Gemini prompts. */
export const formatLifeContextForPrompt = (ctx: UserLifeContext): string => {
  const list = <T,>(items: T[], fmt: (item: T) => string): string =>
    items.length ? items.map((i) => `  - ${fmt(i)}`).join("\n") : "  (none)"

  const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "no date")

  return [
    "Life areas:",
    list(ctx.areas, (a) => `"${a.name}"`),
    "Goals (not completed):",
    list(
      ctx.goals,
      (g) => `"${g.title}" — ${g.status}${g.areaName ? `, area: ${g.areaName}` : ""}, deadline: ${fmtDate(g.deadline)}`,
    ),
    "Habits (active):",
    list(ctx.habits, (h) => `"${h.title}" — ${h.frequency}${h.areaName ? `, area: ${h.areaName}` : ""}`),
    "Open tasks:",
    list(
      ctx.tasks,
      (t) => `"${t.title}" — ${t.status}, priority ${t.priority}${t.areaName ? `, area: ${t.areaName}` : ""}, due: ${fmtDate(t.dueDate)}`,
    ),
    "Learning topics (Learn module — a topic can exist with no resources added yet):",
    list(ctx.topics, (t) => `"${t.title}" — mastery: ${t.masteryLevel}${t.areaName ? `, area: ${t.areaName}` : ""}`),
    "Learning resources (not completed):",
    list(
      ctx.resources,
      (r) => `"${r.title}" (topic: ${r.topicTitle}) — ${r.status}${r.areaName ? `, area: ${r.areaName}` : ""}`,
    ),
  ].join("\n")
}
