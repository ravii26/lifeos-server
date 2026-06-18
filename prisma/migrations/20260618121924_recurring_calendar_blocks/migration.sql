-- AlterTable
ALTER TABLE "CalendarBlock" ADD COLUMN     "recurrenceRule" TEXT;

-- CreateTable
CREATE TABLE "CalendarBlockException" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "occurrenceDate" TIMESTAMP(3) NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "blockType" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarBlockException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarBlockException_blockId_occurrenceDate_key" ON "CalendarBlockException"("blockId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "CalendarBlockException" ADD CONSTRAINT "CalendarBlockException_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "CalendarBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
