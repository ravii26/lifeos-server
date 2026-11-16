-- AlterTable
-- Additive only: three nullable columns. Existing rows keep NULL
-- (a date with no kind keeps behaving as "by"; no window = anytime).
ALTER TABLE "Task" ADD COLUMN     "dueKind" TEXT;
ALTER TABLE "Task" ADD COLUMN     "windowFrom" TEXT;
ALTER TABLE "Task" ADD COLUMN     "windowTo" TEXT;
