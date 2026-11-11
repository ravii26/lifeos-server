import prisma from "../../lib/prisma.js"
import { searchItems, visibleMemories, type SearchHit, type Searchable } from "./search.rules.js"
import { allowedKeys, fuseRankings, meaningHits, scheduleLifeIndexSync } from "./life-index.js"

interface SaveProposal {
  proposal?: { contentTitle?: string }
}

// One question across everything the person put in: taught notes, to-dos,
// saves, goals and (non-private) memories. Found by words and by meaning
// (the life index); only real rows come back, so it never invents.
// Everything searchable, and the memories (with their privacy flag) kept apart.
const loadLife = async (userId: string) => {
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

  const things: Searchable[] = [
    ...notes.map((n) => ({ kind: "NOTE" as const, id: n.id, title: n.title, body: [n.collection, ...n.items, n.text ?? ""].join("\n"), at: n.updatedAt })),
    ...tasks.map((t) => ({ kind: "TASK" as const, id: t.id, title: t.title, body: `${t.description ?? ""} ${t.minimumVersion ?? ""}`, at: t.createdAt })),
    ...saves.map((c) => {
      const meta = c.urlMetadata as { title?: string } | null
      const title = (c.suggestedOutputs as SaveProposal | null)?.proposal?.contentTitle ?? meta?.title ?? c.rawText.slice(0, 80)
      return { kind: "SAVE" as const, id: c.id, title, body: `${c.summary ?? ""} ${c.rawText}`, at: c.createdAt }
    }),
    ...projects.map((p) => ({ kind: "PROJECT" as const, id: p.id, title: p.title, body: p.why ?? "", at: p.createdAt })),
  ]
  return { things, memories }
}

type LifeMemory = Awaited<ReturnType<typeof loadLife>>["memories"][number]
const memoryItem = (m: LifeMemory): Searchable => ({ kind: "MEMORY", id: m.id, title: m.content, body: "", at: m.createdAt })

// What the life index holds: everything except private memories, which are never indexed.
const indexable = async (userId: string): Promise<Searchable[]> => {
  const { things, memories } = await loadLife(userId)
  return [...things, ...memories.filter((m) => !m.sensitive).map(memoryItem)]
}

// Called from chat too, so the index fills in without anyone searching.
export const keepLifeIndexFresh = (userId: string): void => scheduleLifeIndexSync(userId, () => indexable(userId))

export const searchAllService = async (userId: string, query: string): Promise<SearchHit[]> => {
  const { things, memories } = await loadLife(userId)
  const items = [...things, ...visibleMemories(memories, query).map(memoryItem)]

  // Keep the life index in step, then fuse the word matches with the meaning matches.
  scheduleLifeIndexSync(userId, [...things, ...memories.filter((m) => !m.sensitive).map(memoryItem)])
  const byWords = searchItems(items, query, 20)
  const byMeaning = await meaningHits(userId, query, allowedKeys(items))
  return byMeaning.length ? fuseRankings([byWords, byMeaning]) : byWords.slice(0, 8)
}
