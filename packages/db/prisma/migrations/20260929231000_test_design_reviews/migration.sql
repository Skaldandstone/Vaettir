CREATE TABLE "TestDesignReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "testCaseId" TEXT NOT NULL REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "inputHash" TEXT NOT NULL,
  "caseHash" TEXT NOT NULL,
  "evidenceRef" TEXT,
  "status" TEXT NOT NULL DEFAULT 'GENERATING',
  "content" JSONB,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "TestDesignReview_testCaseId_inputHash_key" ON "TestDesignReview"("testCaseId", "inputHash");
CREATE INDEX "TestDesignReview_testCaseId_createdAt_idx" ON "TestDesignReview"("testCaseId", "createdAt");
