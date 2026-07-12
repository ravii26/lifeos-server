import prisma from "../../lib/prisma.js"
import type { Prisma } from "@prisma/client"

const withChunkCount = {
  _count: { select: { chunks: true } },
} satisfies Prisma.DocumentInclude

export const createDocument = (data: Prisma.DocumentUncheckedCreateInput) =>
  prisma.document.create({ data })

export const findDocumentsByUser = (
  userId: string,
  filters: Prisma.DocumentWhereInput = {},
) =>
  prisma.document.findMany({
    where: { userId, ...filters },
    orderBy: { createdAt: "desc" },
    include: withChunkCount,
  })

export const findDocumentWithCount = (id: string, userId: string) =>
  prisma.document.findFirst({ where: { id, userId }, include: withChunkCount })

// Owner-scoped finder. Also consumed by the link module's OWNERSHIP_FINDERS,
// which only needs `title`, so this returns the plain row.
export const findDocumentById = (id: string, userId: string) =>
  prisma.document.findFirst({ where: { id, userId } })

export const updateDocument = (
  id: string,
  userId: string,
  data: Prisma.DocumentUpdateInput,
) => prisma.document.updateMany({ where: { id, userId }, data })

export const deleteDocument = (id: string, userId: string) =>
  prisma.document.deleteMany({ where: { id, userId } })

export const createChunks = (data: Prisma.DocumentChunkUncheckedCreateInput[]) =>
  prisma.documentChunk.createMany({ data })

// Load chunks (with vectors + owning doc title) for in-process similarity
// ranking. Scoped to one document, or — for a library-wide ask — every chunk of
// the user's READY documents (PENDING/FAILED docs are excluded so we never rank
// against half-ingested material).
export const findChunksForRetrieval = (userId: string, documentId?: string) =>
  prisma.documentChunk.findMany({
    where: {
      userId,
      ...(documentId ? { documentId } : { document: { status: "READY" } }),
    },
    select: {
      id: true,
      documentId: true,
      heading: true,
      content: true,
      embedding: true,
      document: { select: { title: true } },
    },
  })

// ---- suggestions (phase 2: AI-extracted actions) -------------------

export const createSuggestions = (
  data: Prisma.DocumentSuggestionUncheckedCreateInput[],
) => prisma.documentSuggestion.createMany({ data })

export const findSuggestionsByDocument = (
  userId: string,
  documentId: string,
  filters: Prisma.DocumentSuggestionWhereInput = {},
) =>
  prisma.documentSuggestion.findMany({
    where: { userId, documentId, ...filters },
    orderBy: { createdAt: "asc" },
  })

export const findSuggestionById = (id: string, userId: string) =>
  prisma.documentSuggestion.findFirst({ where: { id, userId } })

export const updateSuggestion = (
  id: string,
  userId: string,
  data: Prisma.DocumentSuggestionUpdateInput,
) => prisma.documentSuggestion.updateMany({ where: { id, userId }, data })

// Clear the previous round of un-acted-on suggestions before a re-extract, so
// they don't pile up. ACCEPTED/DISMISSED rows are kept as history.
export const deletePendingSuggestions = (userId: string, documentId: string) =>
  prisma.documentSuggestion.deleteMany({
    where: { userId, documentId, status: "PENDING" },
  })
