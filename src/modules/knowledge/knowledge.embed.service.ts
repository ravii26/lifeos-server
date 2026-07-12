import type { Prisma, KnowledgeSourceType } from "@prisma/client"
import { chunkDocument } from "../../lib/chunking.js"
import { embedTexts, embeddingsAvailable } from "../../lib/embeddings.js"
import logger from "../../lib/logger.js"
import { createKnowledgeChunks, deleteChunksForSource } from "./knowledge.repository.js"

// Chunk + embed a Note/Resource's text and (re)persist it as KnowledgeChunk
// rows, replacing whatever was there before. Mirrors document.service.ts's
// `ingest`, but runs synchronously inline (no PENDING/READY status — callers
// fire this in the background the same way document ingestion does) since
// Note/Resource content is small compared to a pasted document.
export const embedSource = async (
  userId: string,
  sourceType: KnowledgeSourceType,
  sourceId: string,
  title: string,
  text: string,
): Promise<void> => {
  const trimmed = text.trim()
  if (!trimmed) {
    await removeSource(userId, sourceType, sourceId)
    return
  }

  const chunks = chunkDocument(trimmed)
  if (chunks.length === 0) {
    await removeSource(userId, sourceType, sourceId)
    return
  }

  // Embeddings require Gemini. Without a key we still persist the chunks (so
  // keyword-based ask works), same degrade-gracefully pattern as Documents.
  let embeddings: number[][] = []
  if (embeddingsAvailable()) {
    embeddings = await embedTexts(chunks.map((c) => c.content))
  }

  const rows: Prisma.KnowledgeChunkUncheckedCreateInput[] = chunks.map((c, i) => ({
    userId,
    sourceType,
    sourceId,
    sourceTitle: title,
    heading: c.heading ?? null,
    content: c.content,
    embedding: embeddings[i] ?? [],
  }))

  await deleteChunksForSource(userId, sourceType, sourceId)
  await createKnowledgeChunks(rows)
}

export const removeSource = (
  userId: string,
  sourceType: KnowledgeSourceType,
  sourceId: string,
): Promise<unknown> => deleteChunksForSource(userId, sourceType, sourceId)

// Fire-and-forget wrapper for call sites that shouldn't block their response
// on embedding (matches document.service.ts's `void ingest(...).catch(...)`).
export const embedSourceInBackground = (
  userId: string,
  sourceType: KnowledgeSourceType,
  sourceId: string,
  title: string,
  text: string,
): void => {
  void embedSource(userId, sourceType, sourceId, title, text).catch((err) => {
    logger.error(`Knowledge embedding failed for ${sourceType} ${sourceId}:`, err)
  })
}
