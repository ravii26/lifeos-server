-- AlterTable
-- Additive only: one nullable column. Existing rows keep NULL (not set).
ALTER TABLE "Area" ADD COLUMN     "weeklyMinutes" INTEGER;
