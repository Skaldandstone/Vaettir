-- Additive OAuth state; existing token, identity, selection and evidence rows are preserved.
CREATE TABLE "AtlassianOAuthConnection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "clerkActorId" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "encryptedApplication" JSONB NOT NULL,
  "encryptedState" JSONB,
  "encryptedToken" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "operationId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "authorizationExpiresAt" TIMESTAMP(3) NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3),
  "accountId" TEXT,
  "accountName" TEXT,
  "sites" JSONB NOT NULL DEFAULT '[]',
  "selectedSite" JSONB,
  "catalog" JSONB,
  "approvedResources" JSONB NOT NULL DEFAULT '[]',
  "approvalReceipts" JSONB NOT NULL DEFAULT '[]',
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AtlassianOAuthConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AtlassianOAuthConnection_product_check" CHECK ("product" IN ('jira','confluence')),
  CONSTRAINT "AtlassianOAuthConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AtlassianOAuthConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AtlassianOAuthConnection_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AtlassianOAuthConnection_requestKey_key" ON "AtlassianOAuthConnection"("requestKey");
CREATE UNIQUE INDEX "AtlassianOAuthConnection_stateHash_key" ON "AtlassianOAuthConnection"("stateHash");
CREATE INDEX "AtlassianOAuthConnection_projectId_actorId_createdAt_idx" ON "AtlassianOAuthConnection"("projectId","actorId","createdAt");
ALTER TABLE "TicketSourceConnection" ADD COLUMN "oauthConnectionId" TEXT;
CREATE UNIQUE INDEX "TicketSourceConnection_oauthConnectionId_key" ON "TicketSourceConnection"("oauthConnectionId");
ALTER TABLE "TicketSourceConnection" ADD CONSTRAINT "TicketSourceConnection_oauthConnectionId_fkey" FOREIGN KEY ("oauthConnectionId") REFERENCES "AtlassianOAuthConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
