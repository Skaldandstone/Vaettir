CREATE TABLE "RepositoryProcessingApproval" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "purpose" TEXT NOT NULL,
  "repositoryUrl" TEXT NOT NULL, "ref" TEXT NOT NULL, "pathPrefixes" TEXT[] NOT NULL,
  "scopeHash" TEXT NOT NULL, "unitCreditEstimate" INTEGER NOT NULL, "maxItems" INTEGER NOT NULL,
  "sourceApprovedAt" TIMESTAMP(3) NOT NULL, "aiApprovedAt" TIMESTAMP(3) NOT NULL,
  "costApprovedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READING', "resolvedCommitSha" TEXT, "results" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RepositoryProcessingApproval_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RepositoryProcessingApproval_projectId_actorId_requestId_key" ON "RepositoryProcessingApproval"("projectId","actorId","requestId");
CREATE INDEX "RepositoryProcessingApproval_organizationId_actorId_createdAt_idx" ON "RepositoryProcessingApproval"("organizationId","actorId","createdAt");
ALTER TABLE "ReverseEngineerJob" ADD COLUMN "processingApprovalId" TEXT, ADD COLUMN "aiProcessingStartedAt" TIMESTAMP(3), ADD COLUMN "paidProcessingResult" JSONB;
CREATE UNIQUE INDEX "ReverseEngineerJob_processingApprovalId_inputRef_key" ON "ReverseEngineerJob"("processingApprovalId","inputRef");
ALTER TABLE "ReverseEngineerJob" ADD CONSTRAINT "ReverseEngineerJob_processingApprovalId_fkey" FOREIGN KEY ("processingApprovalId") REFERENCES "RepositoryProcessingApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
