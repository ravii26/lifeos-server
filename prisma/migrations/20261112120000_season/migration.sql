-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "seasonEndEvent" TEXT,
ADD COLUMN     "seasonEndsAt" TIMESTAMP(3),
ADD COLUMN     "seasonName" TEXT,
ADD COLUMN     "seasonNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seasonStartedAt" TIMESTAMP(3);
