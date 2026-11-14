-- AlterTable
-- Additive only: one nullable column. Existing rows keep NULL (normal energy).
ALTER TABLE "Task" ADD COLUMN     "energy" TEXT;
