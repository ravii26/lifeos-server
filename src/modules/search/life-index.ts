/* =====================================================================
   The life index (ADR 0043). Everything the person put in (notes, to-dos,
   saves, goals, non-private memories) lives in one table with a meaning
   vector, so one search finds "my coding plan" even when the note says
   "DSA prep". It is the base the chat tools will search instead of being
   handed the whole life every message.

   - The real rows stay the truth. The index is rebuilt from them: changed
     text is re-embedded (a hash says what changed), removed things go.
   - Private memories (health, mental health) are never indexed or sent out.
   - Everything is best-effort: no key, no table yet, a slow embedding
     service, and search falls back to words only, exactly as before.
   - Similarity is computed here, in the app. At personal scale (hundreds of
     rows) that is fast; pgvector in Neon is the next step if it grows.
   ===================================================================== */
import { createHash } from "node:crypto"
import prisma from "../../lib/prisma.js"
import { cosineSimilarity, embedText, embeddingsAvailable } from "../../lib/embeddings.js"
import logger from "../../lib/logger.js"
import type { Searchable, SearchHit } from "./search.rules.js"

const DIMS = 768
const MAX_TEXT = 2000
// Embeddings made per sync, so a big first sync spreads over a few searches.
const EMBED_PER_SYNC = 40
const SYNC_EVERY_MS = 2 * 60_000
const QUERY_TIMEOUT_MS = 2_500
// Google's similarities sit in a narrow band: related ~0.64 and up, unrelated
// ~0.54-0.60 (measured for memories, ADR 0035). Below this is noise.
const MIN_SIMILARITY = 0.62
// Reciprocal rank fusion constant: the usual 60 keeps one list from dominating.
const RRF_K = 60

export const indexText = (it: Pick<Searchable, "title" | "body">): string => `${it.title}\n${it.body}`.trim().slice(0, MAX_TEXT)
export const hashOf = (text: string): string => createHash("sha1").update(text).digest("hex")
const keyOf = (kind: string, id: string) => `${kind}:${id}`

export interface IndexRow {
  id: string
  kind: string
  refId: string
  hash: string
}

// Pure: which items are new or changed, and which index rows point at nothing now.
export const planIndexChanges = (existing: IndexRow[], items: Searchable[]): { upserts: Searchable[]; removeIds: string[] } => {
  const have = new Map(existing.map((r) => [keyOf(r.kind, r.refId), r]))
  const wanted = new Set(items.map((it) => keyOf(it.kind, it.id)))
  return {
    upserts: items.filter((it) => have.get(keyOf(it.kind, it.id))?.hash !== hashOf(indexText(it))),
    removeIds: existing.filter((r) => !wanted.has(keyOf(r.kind, r.refId))).map((r) => r.id),
  }
}

// Reciprocal rank fusion: each list votes 1/(k + rank) for its hits; the first
// list's copy of a hit is kept (the word search has the better snippet).
export const fuseRankings = (lists: SearchHit[][], limit = 8, k = RRF_K): SearchHit[] => {
  const scored = new Map<string, { hit: SearchHit; score: number }>()
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const key = keyOf(hit.kind, hit.id)
      const prev = scored.get(key)
      scored.set(key, { hit: prev?.hit ?? hit, score: (prev?.score ?? 0) + 1 / (k + rank + 1) })
    })
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ hit, score }) => ({ ...hit, score }))
}

// Pure: the closest rows to the query vector, best first, above the noise floor.
export const nearest = <T extends { embedding: number[] }>(rows: T[], query: number[], limit: number, floor = MIN_SIMILARITY): (T & { similarity: number })[] =>
  rows
    .filter((r) => r.embedding.length === query.length)
    .map((r) => ({ ...r, similarity: cosineSimilarity(r.embedding, query) }))
    .filter((r) => r.similarity >= floor)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)

// Brings the index up to date with the person's real rows and embeds what is missing.
export const syncLifeIndex = async (userId: string, items: Searchable[]): Promise<{ upserted: number; removed: number; embedded: number }> => {
  const existing = await prisma.lifeIndexEntry.findMany({ where: { userId }, select: { id: true, kind: true, refId: true, hash: true } })
  const { upserts, removeIds } = planIndexChanges(existing, items)
  if (removeIds.length) await prisma.lifeIndexEntry.deleteMany({ where: { userId, id: { in: removeIds } } })
  for (const it of upserts) {
    const text = indexText(it)
    const data = { title: it.title.slice(0, 300), body: it.body.slice(0, MAX_TEXT), hash: hashOf(text), embedding: [] as number[] }
    await prisma.lifeIndexEntry.upsert({
      where: { userId_kind_refId: { userId, kind: it.kind, refId: it.id } },
      create: { userId, kind: it.kind, refId: it.id, ...data },
      update: data,
    })
  }

  let embedded = 0
  if (embeddingsAvailable()) {
    const missing = await prisma.lifeIndexEntry.findMany({
      where: { userId, embedding: { isEmpty: true } },
      select: { id: true, title: true, body: true },
      take: EMBED_PER_SYNC,
    })
    for (const row of missing) {
      try {
        const embedding = await embedText(indexText(row), { task: "RETRIEVAL_DOCUMENT", dims: DIMS })
        await prisma.lifeIndexEntry.update({ where: { id: row.id }, data: { embedding } })
        embedded++
      } catch (err) {
        logger.warn(`life index embedding stopped: ${(err as Error).message}`)
        break
      }
    }
  }
  return { upserted: upserts.length, removed: removeIds.length, embedded }
}

// At most one sync per person every couple of minutes, in the background.
// `items` can be a loader, so callers that do not have the rows skip loading them when no sync is due.
const lastSync = new Map<string, number>()
export const scheduleLifeIndexSync = (userId: string, items: Searchable[] | (() => Promise<Searchable[]>), now = Date.now()): void => {
  if (now - (lastSync.get(userId) ?? 0) < SYNC_EVERY_MS) return
  lastSync.set(userId, now)
  void (async () => syncLifeIndex(userId, typeof items === "function" ? await items() : items))().catch((err) =>
    logger.warn(`life index sync skipped: ${(err as Error).message}`),
  )
}

const embedSearchQuery = async (query: string): Promise<number[] | null> => {
  if (!embeddingsAvailable() || query.trim().length < 3) return null
  try {
    return await Promise.race([
      embedText(query.slice(0, 500), { task: "RETRIEVAL_QUERY", dims: DIMS }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), QUERY_TIMEOUT_MS)),
    ])
  } catch (err) {
    logger.warn(`search embedding skipped: ${(err as Error).message}`)
    return null
  }
}

// Things that mean what the query means. Only ids in `allowed` come back, so a
// stale entry for something deleted, or anything not this person's, never shows.
export const meaningHits = async (userId: string, query: string, allowed: Set<string>, limit = 12): Promise<SearchHit[]> => {
  const vector = await embedSearchQuery(query)
  return vector ? meaningHitsFor(userId, vector, allowed, limit) : []
}

// The same, for a caller that already has the query's vector (chat embeds each message once).
export const meaningHitsFor = async (userId: string, vector: number[], allowed: Set<string>, limit = 12): Promise<SearchHit[]> => {
  try {
    const rows = await prisma.lifeIndexEntry.findMany({
      where: { userId, embedding: { isEmpty: false } },
      select: { kind: true, refId: true, title: true, body: true, embedding: true },
    })
    return nearest(rows.filter((r) => allowed.has(keyOf(r.kind, r.refId))), vector, limit).map((r) => ({
      kind: r.kind as SearchHit["kind"],
      id: r.refId,
      title: r.title,
      snippet: r.body.length > 140 ? `${r.body.slice(0, 137)}…` : r.body,
      score: r.similarity,
    }))
  } catch (err) {
    logger.warn(`meaning search skipped: ${(err as Error).message}`)
    return []
  }
}

export const allowedKeys = (items: Searchable[]): Set<string> => new Set(items.map((it) => keyOf(it.kind, it.id)))
