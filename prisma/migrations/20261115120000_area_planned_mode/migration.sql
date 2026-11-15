-- AlterTable
-- Additive only: two nullable columns. Existing areas keep NULL (nothing planned).
ALTER TABLE "Area" ADD COLUMN     "nextTier" "AreaTier",
ADD COLUMN     "nextTierOn" TIMESTAMP(3);
