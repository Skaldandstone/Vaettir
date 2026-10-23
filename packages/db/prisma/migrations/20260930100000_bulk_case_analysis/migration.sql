CREATE TABLE "AiCreditUseRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "caseIds" TEXT[] NOT NULL,
    "caseCount" INTEGER NOT NULL,
    "estimatedCredits" INTEGER NOT NULL,
    "reason" TEXT,
    "dedupeKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCreditUseRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiCreditUseRequest_organizationId_status_createdAt_idx" ON "AiCreditUseRequest"("organizationId", "status", "createdAt");
CREATE INDEX "AiCreditUseRequest_requestedById_createdAt_idx" ON "AiCreditUseRequest"("requestedById", "createdAt");
CREATE UNIQUE INDEX "AiCreditUseRequest_dedupeKey_key" ON "AiCreditUseRequest"("dedupeKey");
ALTER TABLE "AiCreditUseRequest" ADD CONSTRAINT "AiCreditUseRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TestCaseRiskReview" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "content" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TestCaseRiskReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestCaseRiskReview_testCaseId_inputHash_key" ON "TestCaseRiskReview"("testCaseId", "inputHash");
CREATE INDEX "TestCaseRiskReview_testCaseId_createdAt_idx" ON "TestCaseRiskReview"("testCaseId", "createdAt");
ALTER TABLE "TestCaseRiskReview" ADD CONSTRAINT "TestCaseRiskReview_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
