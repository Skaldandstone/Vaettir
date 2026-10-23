-- Additive metadata-only traceability and report history. No customer rows change.
CREATE TABLE "CaseTraceabilityState" (
  "projectId" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CaseTraceabilityState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Requirement_id_projectId_key" ON "Requirement"("id", "projectId");
CREATE TABLE "CaseTraceabilityLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerOrigin" TEXT NOT NULL,
  "nativeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT,
  "requirementId" TEXT,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "removedAt" TIMESTAMP(3),
  CONSTRAINT "CaseTraceabilityLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CaseTraceabilityState"("projectId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CaseTraceabilityLink_caseId_projectId_fkey" FOREIGN KEY ("caseId", "projectId") REFERENCES "TestCase"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseTraceabilityLink_requirementId_projectId_fkey" FOREIGN KEY ("requirementId", "projectId") REFERENCES "Requirement"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CaseTraceabilityLink_projectId_caseId_removedAt_idx" ON "CaseTraceabilityLink"("projectId", "caseId", "removedAt");
CREATE INDEX "CaseTraceabilityLink_projectId_provider_providerOrigin_nativeId_idx" ON "CaseTraceabilityLink"("projectId", "provider", "providerOrigin", "nativeId");
CREATE TABLE "CaseTraceabilityWrite" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "appliedVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseTraceabilityWrite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CaseTraceabilityState"("projectId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CaseTraceabilityWrite_projectId_createdAt_idx" ON "CaseTraceabilityWrite"("projectId", "createdAt");
CREATE TABLE "ProjectReportDefinition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectReportDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProjectReportDefinition_projectId_updatedAt_idx" ON "ProjectReportDefinition"("projectId", "updatedAt");
CREATE TABLE "ProjectReportSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "definitionId" TEXT,
  "organizationId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectReportSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectReportSnapshot_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ProjectReportDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ProjectReportSnapshot_projectId_createdAt_idx" ON "ProjectReportSnapshot"("projectId", "createdAt");
