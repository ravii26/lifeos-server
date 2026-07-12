-- CreateEnum
CREATE TYPE "SuggestionType" AS ENUM ('HABIT', 'GOAL', 'TASK');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "BehaviorEvent" ADD VALUE 'SUGGESTIONS_EXTRACTED';

-- CreateTable
CREATE TABLE "DocumentSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "itemType" "SuggestionType" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "sourceHeading" TEXT,
    "meta" JSONB,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdEntityType" TEXT,
    "createdEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentSuggestion_userId_documentId_idx" ON "DocumentSuggestion"("userId", "documentId");

-- AddForeignKey
ALTER TABLE "DocumentSuggestion" ADD CONSTRAINT "DocumentSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSuggestion" ADD CONSTRAINT "DocumentSuggestion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
