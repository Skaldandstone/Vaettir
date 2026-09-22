CREATE TYPE "UnrealPlaytestJobStatus" AS ENUM ('QUEUED', 'CLAIMED', 'PASSED', 'FAILED', 'ERROR');

CREATE TABLE "UnrealPlaytestBinding" (
    "testCaseId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UnrealPlaytestBinding_pkey" PRIMARY KEY ("testCaseId")
);

CREATE TABLE "UnrealPlaytestCatalog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "maps" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UnrealPlaytestCatalog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UnrealPlaytestJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" "UnrealPlaytestJobStatus" NOT NULL DEFAULT 'QUEUED',
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,
    "testRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UnrealPlaytestJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnrealPlaytestJob_testRunId_key" ON "UnrealPlaytestJob"("testRunId");
CREATE UNIQUE INDEX "UnrealPlaytestCatalog_projectId_projectKey_key" ON "UnrealPlaytestCatalog"("projectId", "projectKey");
CREATE INDEX "UnrealPlaytestJob_projectId_projectKey_status_createdAt_idx" ON "UnrealPlaytestJob"("projectId", "projectKey", "status", "createdAt");
CREATE INDEX "UnrealPlaytestJob_testCaseId_createdAt_idx" ON "UnrealPlaytestJob"("testCaseId", "createdAt");

ALTER TABLE "UnrealPlaytestBinding" ADD CONSTRAINT "UnrealPlaytestBinding_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnrealPlaytestCatalog" ADD CONSTRAINT "UnrealPlaytestCatalog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnrealPlaytestJob" ADD CONSTRAINT "UnrealPlaytestJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnrealPlaytestJob" ADD CONSTRAINT "UnrealPlaytestJob_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnrealPlaytestJob" ADD CONSTRAINT "UnrealPlaytestJob_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
