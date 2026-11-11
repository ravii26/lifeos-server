-- CreateTable
CREATE TABLE "ContentRead" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT,
    "lines" TEXT[],
    "purpose" TEXT NOT NULL,
    "feelings" TEXT[],
    "contentType" TEXT,
    "domain" TEXT,
    "lengthMinutes" INTEGER,
    "reused" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentRead_key_key" ON "ContentRead"("key");

