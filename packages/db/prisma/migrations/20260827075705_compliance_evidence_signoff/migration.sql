-- CreateTable
CREATE TABLE "ComplianceEvidence" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "testResultId" TEXT,
    "projectId" TEXT NOT NULL,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,

    CONSTRAINT "ComplianceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceSignOff" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "signedById" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceSignOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceEvidence_controlId_recordedAt_idx" ON "ComplianceEvidence"("controlId", "recordedAt");

-- CreateIndex
CREATE INDEX "ComplianceEvidence_projectId_recordedAt_idx" ON "ComplianceEvidence"("projectId", "recordedAt");

-- CreateIndex
CREATE INDEX "ComplianceSignOff_controlId_period_idx" ON "ComplianceSignOff"("controlId", "period");

-- CreateIndex
CREATE INDEX "ComplianceSignOff_projectId_signedAt_idx" ON "ComplianceSignOff"("projectId", "signedAt");

-- AddForeignKey
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ComplianceControl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_testResultId_fkey" FOREIGN KEY ("testResultId") REFERENCES "TestResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSignOff" ADD CONSTRAINT "ComplianceSignOff_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ComplianceControl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSignOff" ADD CONSTRAINT "ComplianceSignOff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSignOff" ADD CONSTRAINT "ComplianceSignOff_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
