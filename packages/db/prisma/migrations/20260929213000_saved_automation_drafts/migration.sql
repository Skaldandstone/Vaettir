CREATE TABLE "AutomationDraft" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "testCaseId" TEXT NOT NULL REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "framework" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'GENERATING',
 "content" JSONB,
 "createdById" TEXT NOT NULL,
 "rejectedById" TEXT,
 "rejectedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AutomationDraft_testCaseId_createdAt_idx" ON "AutomationDraft"("testCaseId", "createdAt");
-- A retry or a second tab must not buy another draft while one is retained.
CREATE UNIQUE INDEX "AutomationDraft_active_case" ON "AutomationDraft"("testCaseId") WHERE "status" IN ('GENERATING', 'READY');
