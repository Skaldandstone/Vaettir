-- Additive durable definition retry receipts; no customer or existing report changes.
CREATE TABLE "ProjectReportDefinitionWrite" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "appliedVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectReportDefinitionWrite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProjectReportDefinitionWrite_projectId_createdAt_idx" ON "ProjectReportDefinitionWrite"("projectId", "createdAt");
