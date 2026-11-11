-- CreateTable
CREATE TABLE "LifeIndexEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LifeIndexEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LifeIndexEntry_userId_idx" ON "LifeIndexEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LifeIndexEntry_userId_kind_refId_key" ON "LifeIndexEntry"("userId", "kind", "refId");

-- AddForeignKey
ALTER TABLE "LifeIndexEntry" ADD CONSTRAINT "LifeIndexEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

