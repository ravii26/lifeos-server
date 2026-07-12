import prisma from "../../lib/prisma.js"
import type { Prisma, KnowledgeSourceType } from "@prisma/client"

export const createKnowledgeChunks = (
  data: Prisma.KnowledgeChunkUncheckedCreateInput[],
) => prisma.knowledgeChunk.createMany({ data })

// Notes/Resources have no async ingest step, so a source's chunks are simply
// replaced whenever it's (re)embedded — no PENDING/READY/FAILED status to track.
export const deleteChunksForSource = (
  userId: string,
  sourceType: KnowledgeSourceType,
  sourceId: string,
) =>
  prisma.knowledgeChunk.deleteMany({
    where: { userId, sourceType, sourceId },
  })

// All of a user's Note/Resource chunks, for a library-wide ask.
export const findChunksForUser = (userId: string) =>
  prisma.knowledgeChunk.findMany({
    where: { userId },
    select: {
      sourceType: true,
      sourceId: true,
      sourceTitle: true,
      heading: true,
      content: true,
      embedding: true,
    },
  })
