-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "riskAssessedAt" TIMESTAMP(3),
ADD COLUMN     "riskRationale" TEXT,
ADD COLUMN     "riskScore" INTEGER,
ADD COLUMN     "riskSeverity" "RiskSeverity";

-- CreateTable
CREATE TABLE "TestSelectionRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "baseRef" TEXT NOT NULL,
    "headRef" TEXT NOT NULL,
    "changedFiles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestSelectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSelectionRecommendation" (
    "id" TEXT NOT NULL,
    "testSelectionRunId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "recommended" BOOLEAN NOT NULL,
    "matchReason" TEXT NOT NULL,
    "riskScoreSnapshot" INTEGER,

    CONSTRAINT "TestSelectionRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestSelectionRecommendation_testSelectionRunId_idx" ON "TestSelectionRecommendation"("testSelectionRunId");

-- AddForeignKey
ALTER TABLE "TestSelectionRun" ADD CONSTRAINT "TestSelectionRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSelectionRecommendation" ADD CONSTRAINT "TestSelectionRecommendation_testSelectionRunId_fkey" FOREIGN KEY ("testSelectionRunId") REFERENCES "TestSelectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSelectionRecommendation" ADD CONSTRAINT "TestSelectionRecommendation_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
