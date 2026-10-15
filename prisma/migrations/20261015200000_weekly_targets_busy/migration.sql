-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "countUnit" TEXT,
ADD COLUMN     "sessionMinutes" INTEGER,
ADD COLUMN     "timeBlock" TEXT,
ADD COLUMN     "weeklyTargetCount" INTEGER;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "busyUntil" TIMESTAMP(3);

