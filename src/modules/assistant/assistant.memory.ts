/* =====================================================================
   Chat memory: short facts the assistant learns about the person, so they
   never repeat themselves. Saved from the same AI call that writes the
   reply (no extra round-trip); recalled by importance + word overlap with
   the current message + recency. Everything is visible and deletable.
   ===================================================================== */
import type { Memory, MemoryKind } from "@prisma/client"
import prisma from "../../lib/prisma.js"
import { recordActivity } from "../activity/activity.service.js"
import { visibleMemories } from "../search/search.rules.js"
import { backfillEmbeddings, embedMemory, embedQuery, semanticBonus, similarities } from "./assistant.memory.semantic.js"
import { asksAboutThePast, canEnd, currentMemoryWhere, endFromUntil, idsFrom, ownWords, quoteIsTheirs } from "./assistant.memory.rules.js"
import { checkOldFacts, endMemories } from "./assistant.memory.truth.js"
import { clearProfile } from "./assistant.profile.js"
import logger from "../../lib/logger.js"

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

// Pure ranking so it can be tested without a database. `similar` (memory id ->
// similarity to the message, from assistant.memory.semantic.ts) adds a bonus
// for memories that mean the same thing even when they share no words.
export const rankMemories = <T extends Pick<Memory, "content" | "importance" | "createdAt"> & { id?: string }>(
  memories: T[],
  message: string,
  now: Date = new Date(),
  limit = MAX_RECALL,
  similar?: Map<string, number>,
): T[] => {
  const q = words(message)
  return memories
    .map((m) => {
      const overlap = [...words(m.content)].filter((w) => q.has(w)).length
      const ageDays = (now.getTime() - m.createdAt.getTime()) / 86_400_000
      const recency = Math.max(0, 1 - ageDays / 60) // fades over ~2 months
      const meaning = m.id && similar?.has(m.id) ? semanticBonus(similar.get(m.id)!) : 0
      return { m, score: m.importance * 2 + overlap * 3 + recency * 2 + meaning }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m)
}

// `limit`: how many to send (fewer now that the daily profile carries the big picture).
// `query`: the message's vector when the caller already has it, so it is embedded once.
export const recallMemories = async (userId: string, message: string, opts: { limit?: number; query?: number[] | null } = {}) => {
  const pool = await prisma.memory.findMany({
    where: { userId, ...currentMemoryWhere() },
    orderBy: { createdAt: "desc" },
    take: POOL,
  })
  // Memories saved before embeddings existed get theirs in the background.
  backfillEmbeddings(pool)
  // Only worth a Google call when something could be matched, and nothing is
  // lost if it fails: the ranking just falls back to words, importance, recency.
  const embedded = pool.filter((m) => m.embedding.length > 0)
  const query = embedded.length > 0 ? (opts.query !== undefined ? opts.query : await embedQuery(message)) : null
  const similar = query ? similarities(embedded, query) : undefined
  // Health and mental-health memories stay out of the prompt unless the person raises the topic.
  return rankMemories(visibleMemories(pool, message), message, new Date(), opts.limit ?? MAX_RECALL, similar)
}

// What used to be true, only when the message asks about the past.
export const recallPastMemories = async (userId: string, message: string) => {
  if (!asksAboutThePast(message)) return []
  const past = await prisma.memory.findMany({
    where: { userId, endedAt: { lte: new Date() } },
    orderBy: { endedAt: "desc" },
    take: 20,
  })
  return visibleMemories(past, message).slice(0, 8)
}

export interface MemoryWrite {
  content?: unknown
  kind?: unknown
  importance?: unknown
  source?: unknown
  sensitive?: unknown
  quote?: unknown
  replaces?: unknown
  until?: unknown
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

// Saves what the model chose to remember, skipping exact repeats. `known` is
// what is true now and `said` is what the person actually wrote: a memory
// whose quote is not in there is dropped. Returns what was actually stored so
// the app can show "Remembered: …".
export const saveMemories = async (userId: string, writes: MemoryWrite[], known: Memory[], said: string[], timeZone = "Asia/Kolkata") => {
  const seen = new Set(known.map((m) => normalize(m.content)))
  const own = ownWords(said)
  const saved: (Memory & { activityId?: string })[] = []
  for (const w of writes.slice(0, 3)) {
    const content = typeof w.content === "string" ? w.content.trim().slice(0, 280) : ""
    if (content.length < 4 || seen.has(normalize(content))) continue
    if (!quoteIsTheirs(w.quote, own)) {
      logger.info("memory dropped: its quote is not in the person's own words")
      continue
    }
    const kind = MEMORY_KINDS.includes(w.kind as MemoryKind) ? (w.kind as MemoryKind) : "FACT"
    const importance = [1, 2, 3].includes(Number(w.importance)) ? Number(w.importance) : 2
    const source = w.source === "SAID" ? "SAID" : "INFERRED"
    const sensitive = w.sensitive === true
    const quote = String(w.quote).trim().slice(0, 280)
    const endedAt = endFromUntil(w.until, timeZone)
    const memory = await prisma.memory.create({ data: { userId, content, kind, importance, source, sensitive, quote, endedAt } })
    const vector = embedMemory(memory.id, content, sensitive)
    // Something true only for a while ("in Goa till Sunday") never ends what is lasting ("lives in Mumbai").
    if (!endedAt) {
      const named = new Set(idsFrom(w.replaces))
      const replaced = known.filter((m) => named.has(m.id) && canEnd(m, memory))
      if (replaced.length > 0) await endMemories(userId, replaced, memory.id)
      else void checkOldFacts(userId, memory, vector)
    }
    const event = await recordActivity(userId, {
      type: "REMEMBERED",
      itemType: "MEMORY",
      itemId: memory.id,
      title: content,
      source: "CHAT",
      undo: { kind: "DELETE_MEMORY", memoryId: memory.id },
    })
    saved.push({ ...memory, activityId: event?.id })
    seen.add(normalize(content))
  }
  return saved
}

// "Forget that" only ever deletes memories that were in the recalled set,
// i.e. ids the model was actually shown for this user.
export const forgetMemories = async (userId: string, ids: unknown[], known: Memory[]) => {
  const allowed = new Set(known.map((m) => m.id))
  const target = ids.filter((id): id is string => typeof id === "string" && allowed.has(id))
  if (target.length === 0) return [] as (Memory & { activityId?: string })[]
  const gone = known.filter((m) => target.includes(m.id))
  await prisma.memory.deleteMany({ where: { userId, id: { in: target } } })
  await clearProfile(userId)
  const out: (Memory & { activityId?: string })[] = []
  for (const m of gone) {
    const event = await recordActivity(userId, {
      type: "FORGOTTEN",
      itemType: "MEMORY",
      itemId: m.id,
      title: m.content,
      source: "CHAT",
      undo: {
        kind: "RESTORE_MEMORY",
        memory: { content: m.content, kind: m.kind, importance: m.importance, source: m.source, sensitive: m.sensitive, quote: m.quote },
      },
    })
    out.push({ ...m, activityId: event?.id })
  }
  return out
}

export const listMemories = (userId: string) =>
  prisma.memory.findMany({ where: { userId }, orderBy: [{ importance: "desc" }, { createdAt: "desc" }] })

export const deleteMemory = async (userId: string, id: string) => {
  const result = await prisma.memory.deleteMany({ where: { userId, id } })
  if (result.count > 0) await clearProfile(userId)
  return result
}

// "Still true": Ally retired this by mistake, so it counts again.
export const restoreMemory = async (userId: string, id: string) => {
  const result = await prisma.memory.updateMany({ where: { userId, id }, data: { endedAt: null, replacedById: null } })
  if (result.count > 0) await clearProfile(userId)
  return result
}
