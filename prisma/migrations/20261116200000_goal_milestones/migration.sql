-- AlterTable
-- Additive only: two nullable columns. Existing goals keep NULL (goals of their own).
ALTER TABLE "Goal" ADD COLUMN     "order" INTEGER,
ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Goal_parentId_idx" ON "Goal"("parentId");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
