-- AlterTable
ALTER TABLE "Capture" ADD COLUMN     "mediaType" "MediaType" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "mediaUrl" TEXT;

-- AlterTable
ALTER TABLE "UserSettings" ALTER COLUMN "enabledModules" DROP DEFAULT;
