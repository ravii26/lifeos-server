import prisma from "../../lib/prisma.js"
import { searchItems, visibleMemories, type SearchHit, type Searchable } from "./search.rules.js"

interface SaveProposal {
  proposal?: { contentTitle?: string }
}

// One question across everything the person put in: taught notes, to-dos,
// saves, goals and (non-private) memories. Rules only, so it never invents.
export const searchAllService = async (userId: string, query: string): Promise<SearchHit[]> => {
  const [notes, tasks, saves, projects, memories] = await Promise.all([
    prisma.allyNote.findMany({ where: { userId }, take: 300 }),
    prisma.task.findMany({
      where: { userId, archivedAt: null, status: { not: "CANCELLED" } },
      select: { id: true, title: true, description: true, minimumVersion: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.capture.findMany({
      where: { userId, OR: [{ purpose: { not: null } }, { suggestedOutputs: { path: ["kind"], equals: "SAVE" } }] },
      select: { id: true, rawText: true, summary: true, suggestedOutputs: true, urlMetadata: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.project.findMany({ where: { userId, status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true, title: true, why: true, createdAt: true }, take: 50 }),
    prisma.memory.findMany({ where: { userId }, select: { id: true, content: true, sensitive: true, createdAt: true }, take: 300 }),
  ])

  const items: Searchable[] = [
    ...notes.map((n) => ({ kind: "NOTE" as const, id: n.id, title: n.title, body: [n.collection, ...n.items, n.text ?? ""].join("\n"), at: n.updatedAt })),
    ...tasks.map((t) => ({ kind: "TASK" as const, id: t.id, title: t.title, body: `${t.description ?? ""} ${t.minimumVersion ?? ""}`, at: t.createdAt })),
    ...saves.map((c) => {
      const meta = c.urlMetadata as { title?: string } | null
      const title = (c.suggestedOutputs as SaveProposal | null)?.proposal?.contentTitle ?? meta?.title ?? c.rawText.slice(0, 80)
      return { kind: "SAVE" as const, id: c.id, title, body: `${c.summary ?? ""} ${c.rawText}`, at: c.createdAt }
    }),
    ...projects.map((p) => ({ kind: "PROJECT" as const, id: p.id, title: p.title, body: p.why ?? "", at: p.createdAt })),
    ...visibleMemories(memories, query).map((m) => ({ kind: "MEMORY" as const, id: m.id, title: m.content, body: "", at: m.createdAt })),
  ]
  return searchItems(items, query)
}
