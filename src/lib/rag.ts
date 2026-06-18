/* =====================================================================
   RAG (Retrieval-Augmented Generation) context builder.

   Fetches a lightweight snapshot of the user's key entities and formats
   them for injection into Gemini prompts. Both the capture classifier and
   the decision engine call this so the AI knows the user's actual areas,
   goals, and topics — not just generic categories.
   ===================================================================== */
import prisma from "./prisma.js"

export interface UserRagContext {
  areas: { id: string; name: string; type: string }[]
  goals: { id: string; title: string; areaId: string | null }[]
  topics: { id: string; title: string; areaId: string }[]
}

/** Fetches a compact user context snapshot in 3 parallel queries. */
export const getUserRagContext = async (userId: string): Promise<UserRagContext> => {
  const [areas, goals, topics] = await Promise.all([
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
  ])
  return { areas, goals, topics }
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
    "User's life areas:",
    areasList,
    "Active goals:",
    goalsList,
    "Learning topics:",
    topicsList,
  ].join("\n")
}
