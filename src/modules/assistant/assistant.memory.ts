/* =====================================================================
   Chat memory: short facts the assistant learns about the person, so they
   never repeat themselves. Saved from the same AI call that writes the
   reply (no extra round-trip); recalled by importance + word overlap with
   the current message + recency. Everything is visible and deletable.
   ===================================================================== */
import type { Memory, MemoryKind } from "@prisma/client"
import prisma from "../../lib/prisma.js"

export const MEMORY_KINDS: MemoryKind[] = ["FACT", "PREFERENCE", "GOAL", "STRUGGLE", "FEELING", "PERSON", "EVENT"]

const MAX_RECALL = 25
const POOL = 300

const STOP = new Set(
  "a an the and or but i me my to of in on at for with is am are was were be been it this that you your so just do did not no yes can will".split(" "),
)

const words = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )

// Pure ranking so it can be tested without a database.
export const rankMemories = <T extends Pick<Memory, "content" | "importance" | "createdAt">>(
  memories: T[],
  message: string,
  now: Date = new Date(),
  limit = MAX_RECALL,
): T[] => {
  const q = words(message)
  return memories
    .map((m) => {
      const overlap = [...words(m.content)].filter((w) => q.has(w)).length
      const ageDays = (now.getTime() - m.createdAt.getTime()) / 86_400_000
      const recency = Math.max(0, 1 - ageDays / 60) // fades over ~2 months
      return { m, score: m.importance * 2 + overlap * 3 + recency * 2 }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m)
}

export const recallMemories = async (userId: string, message: string) => {
  const pool = await prisma.memory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: POOL,
  })
  return rankMemories(pool, message)
}

export interface MemoryWrite {
  content?: unknown
  kind?: unknown
  importance?: unknown
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

// Saves what the model chose to remember, skipping exact repeats. Returns
// what was actually stored so the app can show "Remembered: …".
export const saveMemories = async (userId: string, writes: MemoryWrite[], known: Memory[]) => {
  const seen = new Set(known.map((m) => normalize(m.content)))
  const saved: Memory[] = []
  for (const w of writes.slice(0, 3)) {
    const content = typeof w.content === "string" ? w.content.trim().slice(0, 280) : ""
    if (content.length < 4 || seen.has(normalize(content))) continue
    const kind = MEMORY_KINDS.includes(w.kind as MemoryKind) ? (w.kind as MemoryKind) : "FACT"
    const importance = [1, 2, 3].includes(Number(w.importance)) ? Number(w.importance) : 2
    saved.push(await prisma.memory.create({ data: { userId, content, kind, importance } }))
    seen.add(normalize(content))
  }
  return saved
}

// "Forget that" only ever deletes memories that were in the recalled set,
// i.e. ids the model was actually shown for this user.
export const forgetMemories = async (userId: string, ids: unknown[], known: Memory[]) => {
  const allowed = new Set(known.map((m) => m.id))
  const target = ids.filter((id): id is string => typeof id === "string" && allowed.has(id))
  if (target.length === 0) return [] as Memory[]
  const gone = known.filter((m) => target.includes(m.id))
  await prisma.memory.deleteMany({ where: { userId, id: { in: target } } })
  return gone
}

export const listMemories = (userId: string) =>
  prisma.memory.findMany({ where: { userId }, orderBy: [{ importance: "desc" }, { createdAt: "desc" }] })

export const deleteMemory = (userId: string, id: string) =>
  prisma.memory.deleteMany({ where: { userId, id } })
