-- AlterEnum
ALTER TYPE "GoalStatus" ADD VALUE 'PARKED';

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "parkedAt" TIMESTAMP(3);
