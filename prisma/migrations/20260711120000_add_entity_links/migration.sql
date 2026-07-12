-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('TASK', 'GOAL', 'PROJECT', 'RESOURCE', 'TOPIC', 'NOTE', 'HABIT', 'VAULT');

-- CreateEnum
CREATE TYPE "LinkRole" AS ENUM ('ADVANCES', 'REFERENCES');

-- CreateTable
CREATE TABLE "EntityLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromType" "EntityType" NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" "EntityType" NOT NULL,
    "toId" TEXT NOT NULL,
    "role" "LinkRole" NOT NULL DEFAULT 'REFERENCES',
    "weight" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityLink_userId_fromType_fromId_idx" ON "EntityLink"("userId", "fromType", "fromId");

-- CreateIndex
CREATE INDEX "EntityLink_userId_toType_toId_idx" ON "EntityLink"("userId", "toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityLink_userId_fromType_fromId_toType_toId_role_key" ON "EntityLink"("userId", "fromType", "fromId", "toType", "toId", "role");

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
