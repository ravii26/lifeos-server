-- CreateEnum
CREATE TYPE "ProjectKind" AS ENUM ('OUTCOME', 'MILESTONE', 'PRACTICE', 'WORK');

-- CreateEnum
CREATE TYPE "HabitStage" AS ENUM ('NEW', 'BUILDING', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "SavePurpose" AS ENUM ('LEARN', 'FEELING');

-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('SAID', 'INFERRED');

-- CreateEnum
CREATE TYPE "NoteTemplate" AS ENUM ('LIST', 'ROUTINE', 'PLAYBOOK', 'INFO');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CREATED', 'UPDATED', 'DONE', 'MINIMUM', 'SKIPPED', 'SNOOZED', 'REOPENED', 'ARCHIVED', 'DELETED', 'LOGGED', 'REMEMBERED', 'FORGOTTEN', 'MOOD');

-- CreateEnum
CREATE TYPE "ActivityItem" AS ENUM ('TASK', 'HABIT', 'PROJECT', 'MILESTONE', 'METRIC', 'NOTE', 'SAVE', 'MEMORY', 'DAY', 'SETTING');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('APP', 'CHAT', 'VOICE', 'NOTIFICATION', 'WIDGET', 'SHARE', 'SYSTEM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskSource" ADD VALUE 'REMINDER';
ALTER TYPE "TaskSource" ADD VALUE 'SAVE';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "kind" "ProjectKind" NOT NULL DEFAULT 'WORK',
ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "weeklyTargetMinutes" INTEGER,
ADD COLUMN     "why" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "remindAt" TIMESTAMP(3),
ADD COLUMN     "repeatRule" TEXT,
ADD COLUMN     "sizeMinutes" INTEGER,
ADD COLUMN     "windowEnd" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Habit" ADD COLUMN     "anchor" TEXT,
ADD COLUMN     "prepTime" TEXT,
ADD COLUMN     "sizes" JSONB,
ADD COLUMN     "stage" "HabitStage" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "timeBlock" TEXT;

-- AlterTable
ALTER TABLE "Capture" ADD COLUMN     "feelings" TEXT[],
ADD COLUMN     "purpose" "SavePurpose",
ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "modeUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Memory" ADD COLUMN     "sensitive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "MemorySource" NOT NULL DEFAULT 'INFERRED';

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "target" INTEGER,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metric" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "startValue" DOUBLE PRECISION NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricEntry" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DaySchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "blocks" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DaySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllyNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "template" "NoteTemplate" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "items" TEXT[],
    "text" TEXT,
    "sourceSaveId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllyNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "itemType" "ActivityItem" NOT NULL,
    "itemId" TEXT,
    "title" TEXT,
    "value" DOUBLE PRECISION,
    "minutes" INTEGER,
    "reason" TEXT,
    "mood" TEXT,
    "block" TEXT,
    "source" "ActivitySource" NOT NULL DEFAULT 'APP',
    "undo" JSONB,
    "undoneAt" TIMESTAMP(3),
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Milestone_projectId_order_idx" ON "Milestone"("projectId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Metric_projectId_key" ON "Metric"("projectId");

-- CreateIndex
CREATE INDEX "MetricEntry_metricId_at_idx" ON "MetricEntry"("metricId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "DaySchedule_userId_weekday_key" ON "DaySchedule"("userId", "weekday");

-- CreateIndex
CREATE INDEX "AllyNote_userId_collection_idx" ON "AllyNote"("userId", "collection");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_at_idx" ON "ActivityEvent"("userId", "at");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_itemType_itemId_idx" ON "ActivityEvent"("userId", "itemType", "itemId");

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Metric" ADD CONSTRAINT "Metric_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricEntry" ADD CONSTRAINT "MetricEntry_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "Metric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaySchedule" ADD CONSTRAINT "DaySchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllyNote" ADD CONSTRAINT "AllyNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
