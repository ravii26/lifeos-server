/* =====================================================================
   Recall by meaning (ADR 0035). Each memory is embedded once with Google's
   embedding model; the message being answered is embedded at chat time and
   compared with cosine similarity. Rules still decide: this only adds a bonus
   to the existing ranking (importance, word overlap, recency), and every step
   is best-effort, so without a key, a timeout or an empty column chat works
   exactly as before.
   ===================================================================== */
import prisma from "../../lib/prisma.js"
import { cosineSimilarity, embedText, embeddingsAvailable } from "../../lib/embeddings.js"
import logger from "../../lib/logger.js"

const DIMS = 768
const QUERY_TIMEOUT_MS = 2_500
const BACKFILL_PER_RECALL = 8
// Short replies ("done", "ok", "thanks") have nothing to match on.
const MIN_QUERY_CHARS = 12

// Google's scores sit in a narrow band: related text ~0.64-0.73, unrelated
// ~0.54-0.60 (measured 2026-10-24). So the bonus starts at 0.55 and grows.
const FLOOR = 0.55
const WEIGHT = 60

export const semanticBonus = (similarity: number): number => Math.max(0, similarity - FLOOR) * WEIGHT

const embedDocument = (content: string) => embedText(content, { task: "RETRIEVAL_DOCUMENT", dims: DIMS })

// Embeds one stored memory. Sensitive memories (health, mental health) are not
// sent out; they keep matching on words only.
export const embedMemory = async (id: string, content: string, sensitive: boolean): Promise<void> => {
  if (sensitive || !embeddingsAvailable()) return
  try {
    const embedding = await embedDocument(content)
    await prisma.memory.updateMany({ where: { id }, data: { embedding } })
  } catch (err) {
    logger.warn(`memory embedding skipped: ${(err as Error).message}`)
  }
}

// The embedding of the message, or null when it is not worth one (too short,
// no key, slow or failing service).
export const embedQuery = async (message: string): Promise<number[] | null> => {
  if (!embeddingsAvailable() || message.trim().length < MIN_QUERY_CHARS) return null
  try {
    return await Promise.race([
      embedText(message.slice(0, 2000), { task: "RETRIEVAL_QUERY", dims: DIMS }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), QUERY_TIMEOUT_MS)),
    ])
  } catch (err) {
    logger.warn(`message embedding skipped: ${(err as Error).message}`)
    return null
  }
}

// memory id -> similarity to the message, for the memories that have a vector.
export const similarities = (
  memories: { id: string; embedding: number[] }[],
  query: number[],
): Map<string, number> => {
  const out = new Map<string, number>()
  for (const m of memories) if (m.embedding.length === query.length) out.set(m.id, cosineSimilarity(m.embedding, query))
  return out
}

// Memories saved before this existed (or while the service was down) get their
// vector a few at a time, in the background, as the person chats.
export const backfillEmbeddings = (memories: { id: string; content: string; sensitive: boolean; embedding: number[] }[]): void => {
  if (!embeddingsAvailable()) return
  const missing = memories.filter((m) => !m.sensitive && m.embedding.length === 0).slice(0, BACKFILL_PER_RECALL)
  for (const m of missing) void embedMemory(m.id, m.content, m.sensitive)
}
