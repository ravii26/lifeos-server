-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "sleepFromWake" TEXT,
ADD COLUMN     "sleepHours" INTEGER,
ADD COLUMN     "sleepStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sleepStepAt" TIMESTAMP(3),
ADD COLUMN     "sleepTargetWake" TEXT;
