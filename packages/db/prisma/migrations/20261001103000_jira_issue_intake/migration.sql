CREATE TABLE "JiraIssueImportRun" (
  "id" TEXT NOT NULL, "connectionId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEW', "selectedProjects" JSONB NOT NULL,
  "issues" JSONB NOT NULL DEFAULT '[]', "nextCursor" TEXT, "seenCursors" JSONB NOT NULL DEFAULT '[]',
  "pageCount" INTEGER NOT NULL DEFAULT 0, "readAttempts" INTEGER NOT NULL DEFAULT 0, "pageReceipts" JSONB NOT NULL DEFAULT '[]',
  "leaseRequestId" TEXT, "leaseUntil" TIMESTAMP(3), "lastError" TEXT,
  "approvedIssueIds" JSONB NOT NULL DEFAULT '[]', "approvalRequestId" TEXT, "approvalHash" TEXT,
  "results" JSONB NOT NULL DEFAULT '[]', "version" INTEGER NOT NULL DEFAULT 1,
  "readApprovedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "importApprovedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JiraIssueImportRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JiraIssueImportRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "TicketSourceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JiraIssueImportRun_requestKey_key" ON "JiraIssueImportRun"("requestKey");
CREATE INDEX "JiraIssueImportRun_connectionId_actorId_createdAt_idx" ON "JiraIssueImportRun"("connectionId","actorId","createdAt");
CREATE TABLE "JiraIssueIdentity" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "providerOrigin" TEXT NOT NULL,
  "externalId" TEXT NOT NULL, "requirementId" TEXT, "importedSnapshot" JSONB NOT NULL,
  "importedRunId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JiraIssueIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JiraIssueIdentity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JiraIssueIdentity_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JiraIssueIdentity_projectId_providerOrigin_externalId_key" ON "JiraIssueIdentity"("projectId","providerOrigin","externalId");
