-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('PENDING', 'CONVERTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "WorthCheck" AS ENUM ('WORTH_NOW', 'SAVE_LATER', 'NOT_RELEVANT');

-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "detectedUrl" TEXT,
    "urlMetadata" JSONB,
    "worthCheck" "WorthCheck",
    "worthReason" TEXT,
    "suggestedOutputs" JSONB,
    "createdOutputs" JSONB,
    "status" "CaptureStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
