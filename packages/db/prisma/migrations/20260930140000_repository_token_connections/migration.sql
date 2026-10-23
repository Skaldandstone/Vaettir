-- Token connections are actor-bound and do not require a workspace OAuth app.
-- Existing OAuth configuration IDs and foreign keys remain unchanged.
ALTER TABLE "RepositoryConnection" ALTER COLUMN "configurationId" DROP NOT NULL;
ALTER TABLE "Organization" ADD COLUMN "encryptedDatadogWebhookSecret" JSONB;
CREATE TABLE "ProductionIncidentReceipt" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "riskFlagId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ProductionIncidentReceipt_organizationId_projectId_idx" ON "ProductionIncidentReceipt"("organizationId","projectId");
