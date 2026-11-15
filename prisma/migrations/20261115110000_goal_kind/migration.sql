-- AlterTable
-- Additive only: one nullable column. Existing goals keep NULL (ordinary goals).
ALTER TABLE "Goal" ADD COLUMN     "kind" TEXT;
