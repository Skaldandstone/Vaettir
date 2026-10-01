-- Additive. No legacy upload is silently verified and no existing result changes.
ALTER TABLE "TestCaseAttachment" ADD COLUMN "uploadCompletedAt" TIMESTAMP(3);
ALTER TABLE "TestCaseAttachment" ADD COLUMN "uploadVerification" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "ManualStepResultRevision" (
  "id" TEXT NOT NULL,
  "testRunId" TEXT NOT NULL,
  "testCaseId" TEXT NOT NULL,
  "stepIndex" INTEGER NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "status" "TestResultStatus" NOT NULL,
  "caseStatusAtRecord" "TestResultStatus",
  "note" TEXT,
  "observations" JSONB NOT NULL DEFAULT '{}',
  "evidenceAttachmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "evidenceAttachments" JSONB NOT NULL DEFAULT '[]',
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "correctionReason" TEXT,
  "previousRevisionId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  CONSTRAINT "ManualStepResultRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualStepResultRevision_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManualStepResultRevision_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManualStepResultRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManualStepResultRevision_previousRevisionId_fkey" FOREIGN KEY ("previousRevisionId") REFERENCES "ManualStepResultRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManualStepResultRevision_step_bounds" CHECK ("stepIndex" >= 0 AND "revisionNumber" BETWEEN 1 AND 100 AND "status" <> 'FLAKY')
);
CREATE UNIQUE INDEX "ManualStepResultRevision_previousRevisionId_key" ON "ManualStepResultRevision"("previousRevisionId");
CREATE UNIQUE INDEX "ManualStepResultRevision_scope_revision_key" ON "ManualStepResultRevision"("testRunId", "testCaseId", "stepIndex", "revisionNumber");
CREATE UNIQUE INDEX "ManualStepResultRevision_testRunId_actorId_idempotencyKey_key" ON "ManualStepResultRevision"("testRunId", "actorId", "idempotencyKey");
CREATE INDEX "ManualStepResultRevision_scope_revision_idx" ON "ManualStepResultRevision"("testRunId", "testCaseId", "stepIndex", "revisionNumber");
CREATE INDEX "ManualStepResultRevision_evidenceAttachmentIds_idx" ON "ManualStepResultRevision" USING GIN ("evidenceAttachmentIds");

CREATE TABLE "ManualStepResultHead" (
  "testRunId" TEXT NOT NULL,
  "testCaseId" TEXT NOT NULL,
  "stepIndex" INTEGER NOT NULL,
  "currentRevisionId" TEXT NOT NULL,
  "revisionCount" INTEGER NOT NULL,
  "currentPayloadBytes" INTEGER NOT NULL,
  CONSTRAINT "ManualStepResultHead_pkey" PRIMARY KEY ("testRunId", "testCaseId", "stepIndex"),
  CONSTRAINT "ManualStepResultHead_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManualStepResultHead_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManualStepResultHead_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "ManualStepResultRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManualStepResultHead_step_bounds" CHECK ("stepIndex" >= 0 AND "revisionCount" BETWEEN 1 AND 100 AND "currentPayloadBytes" BETWEEN 1 AND 4194304)
);
CREATE UNIQUE INDEX "ManualStepResultHead_currentRevisionId_key" ON "ManualStepResultHead"("currentRevisionId");
