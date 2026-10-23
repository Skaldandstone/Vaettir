-- Additive metadata-only authorization; existing requirements/credentials remain untouched.
CREATE TABLE "TicketSourceConnection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VERIFYING',
    "encryptedToken" JSONB,
    "authorizationExpiresAt" TIMESTAMP(3) NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "catalog" JSONB,
    "catalogAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "approvedProjects" JSONB NOT NULL DEFAULT '[]',
    "approvalReceipts" JSONB NOT NULL DEFAULT '[]',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketSourceConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketSourceConnection_requestKey_key" ON "TicketSourceConnection"("requestKey");
CREATE INDEX "TicketSourceConnection_projectId_actorId_provider_createdAt_idx" ON "TicketSourceConnection"("projectId", "actorId", "provider", "createdAt");
ALTER TABLE "TicketSourceConnection" ADD CONSTRAINT "TicketSourceConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketSourceConnection" ADD CONSTRAINT "TicketSourceConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketSourceConnection" ADD CONSTRAINT "TicketSourceConnection_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
