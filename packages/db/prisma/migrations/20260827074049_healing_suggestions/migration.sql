-- CreateEnum
CREATE TYPE "HealingClassification" AS ENUM ('BRITTLE', 'REAL_REGRESSION', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "HealingSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "HealingSuggestion" (
    "id" TEXT NOT NULL,
    "testResultId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "classification" "HealingClassification" NOT NULL,
    "classificationRationale" TEXT NOT NULL,
    "suggestedDiff" TEXT,
    "suggestionRationale" TEXT,
    "status" "HealingSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealingSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HealingSuggestion_testResultId_key" ON "HealingSuggestion"("testResultId");

-- CreateIndex
CREATE INDEX "HealingSuggestion_projectId_createdAt_idx" ON "HealingSuggestion"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "HealingSuggestion_testCaseId_idx" ON "HealingSuggestion"("testCaseId");

-- AddForeignKey
ALTER TABLE "HealingSuggestion" ADD CONSTRAINT "HealingSuggestion_testResultId_fkey" FOREIGN KEY ("testResultId") REFERENCES "TestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealingSuggestion" ADD CONSTRAINT "HealingSuggestion_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealingSuggestion" ADD CONSTRAINT "HealingSuggestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealingSuggestion" ADD CONSTRAINT "HealingSuggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
