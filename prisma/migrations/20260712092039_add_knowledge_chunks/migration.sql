-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('NOTE', 'RESOURCE');

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_userId_sourceType_sourceId_idx" ON "KnowledgeChunk"("userId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_userId_idx" ON "KnowledgeChunk"("userId");

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
