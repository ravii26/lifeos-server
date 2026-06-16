-- CreateEnum
CREATE TYPE "VaultType" AS ENUM ('REFLECTION', 'MEMORY', 'MOTIVATION', 'RECOVERY');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('TEXT', 'QUOTE', 'VIDEO', 'AUDIO', 'IMAGE');

-- CreateTable
CREATE TABLE "VaultItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "vaultType" "VaultType" NOT NULL,
    "mediaType" "MediaType" NOT NULL DEFAULT 'TEXT',
    "url" TEXT,
    "triggerTags" TEXT[],
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "VaultItem" ADD CONSTRAINT "VaultItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
