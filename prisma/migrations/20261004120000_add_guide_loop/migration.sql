-- CreateEnum
CREATE TYPE "AreaTier" AS ENUM ('MAIN', 'SECONDARY', 'MAINTAIN', 'LATER');

-- CreateEnum
CREATE TYPE "GuideSourceType" AS ENUM ('TASK', 'HABIT');

-- CreateEnum
CREATE TYPE "GuideMode" AS ENUM ('NORMAL', 'SMALLER');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('PENDING', 'DONE', 'MINIMUM', 'SKIPPED');

-- AlterTable
ALTER TABLE "Area" ADD COLUMN     "laterUntil" TIMESTAMP(3),
ADD COLUMN     "tier" "AreaTier" NOT NULL DEFAULT 'MAINTAIN';

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "why" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "minimumVersion" TEXT;

-- AlterTable
ALTER TABLE "Habit" ADD COLUMN     "minimumVersion" TEXT,
ADD COLUMN     "prepareAhead" TEXT;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "nightlyTime" TEXT;

-- CreateTable
CREATE TABLE "NightlyCommitment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "sourceType" "GuideSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "areaId" TEXT,
    "goalId" TEXT,
    "title" TEXT NOT NULL,
    "minimum" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "mode" "GuideMode" NOT NULL DEFAULT 'NORMAL',
    "source" TEXT NOT NULL DEFAULT 'heuristic',
    "status" "CommitmentStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NightlyCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NightlyCommitment_userId_date_idx" ON "NightlyCommitment"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "NightlyCommitment_userId_date_key" ON "NightlyCommitment"("userId", "date");

-- AddForeignKey
ALTER TABLE "NightlyCommitment" ADD CONSTRAINT "NightlyCommitment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing focus areas start as SECONDARY so the user promotes exactly one to MAIN.
UPDATE "Area" SET "tier" = 'SECONDARY' WHERE "type" = 'PRIMARY';
