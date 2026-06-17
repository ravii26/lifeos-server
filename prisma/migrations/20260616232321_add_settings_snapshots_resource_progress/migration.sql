-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "lessonsCompleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "minutesConsumed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalLessons" INTEGER;

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vibe" TEXT NOT NULL DEFAULT 'calm',
    "accent" TEXT NOT NULL DEFAULT '#6366f1',
    "font" TEXT NOT NULL DEFAULT 'inter',
    "startTab" TEXT NOT NULL DEFAULT 'today',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaScoreSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "tasksDone" INTEGER NOT NULL,
    "tasksTotal" INTEGER NOT NULL,
    "streak" INTEGER NOT NULL,
    "focusMins" INTEGER NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AreaScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaScoreSnapshot" ADD CONSTRAINT "AreaScoreSnapshot_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
