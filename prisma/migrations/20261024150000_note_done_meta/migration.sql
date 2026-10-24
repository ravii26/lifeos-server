-- AlterTable
ALTER TABLE "AllyNote" ADD COLUMN     "done" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "meta" JSONB;

