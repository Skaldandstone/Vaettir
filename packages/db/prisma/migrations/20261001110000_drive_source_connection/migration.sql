CREATE TABLE "DriveSourceConnection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "configurationHash" TEXT NOT NULL,
  "encryptedVerifier" JSONB,
  "encryptedAuthorization" JSONB,
  "encryptedToken" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "authorizationExpiresAt" TIMESTAMP(3) NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3),
  "account" JSONB,
  "catalog" JSONB,
  "catalogAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "readAttempts" INTEGER NOT NULL DEFAULT 0,
  "readLeaseRequestId" TEXT,
  "readLeaseUntil" TIMESTAMP(3),
  "listReceipts" JSONB NOT NULL DEFAULT '[]',
  "approvedFiles" JSONB NOT NULL DEFAULT '[]',
  "approvalReceipts" JSONB NOT NULL DEFAULT '[]',
  "approvedAt" TIMESTAMP(3),
  "metadataApprovedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriveSourceConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DriveSourceConnection_requestKey_key" ON "DriveSourceConnection"("requestKey");
CREATE UNIQUE INDEX "DriveSourceConnection_stateHash_key" ON "DriveSourceConnection"("stateHash");
CREATE INDEX "DriveSourceConnection_projectId_actorId_createdAt_idx" ON "DriveSourceConnection"("projectId", "actorId", "createdAt");
ALTER TABLE "DriveSourceConnection" ADD CONSTRAINT "DriveSourceConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveSourceConnection" ADD CONSTRAINT "DriveSourceConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveSourceConnection" ADD CONSTRAINT "DriveSourceConnection_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
