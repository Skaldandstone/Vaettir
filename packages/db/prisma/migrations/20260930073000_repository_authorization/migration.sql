ALTER TABLE "ProjectRepository" ADD COLUMN "connectionId" TEXT, ADD COLUMN "externalId" TEXT, ADD COLUMN "verifiedAt" TIMESTAMP(3);
CREATE TABLE "RepositoryProviderConfiguration" (
 "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "provider" TEXT NOT NULL,
 "origin" TEXT NOT NULL, "clientId" TEXT NOT NULL, "encryptedSecret" JSONB NOT NULL,
 "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RepositoryProviderConfiguration_organizationId_provider_origin_key" ON "RepositoryProviderConfiguration"("organizationId", "provider", "origin");
CREATE TABLE "RepositoryConnection" (
 "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "configurationId" TEXT NOT NULL, "provider" TEXT NOT NULL,
 "origin" TEXT NOT NULL, "stateHash" TEXT NOT NULL, "encryptedVerifier" JSONB, "encryptedToken" JSONB,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "accountLabel" TEXT, "authorizationExpiresAt" TIMESTAMP(3) NOT NULL,
 "tokenExpiresAt" TIMESTAMP(3), "verifiedAt" TIMESTAMP(3), "catalog" JSONB, "catalogAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RepositoryConnection_stateHash_key" ON "RepositoryConnection"("stateHash");
CREATE INDEX "RepositoryConnection_projectId_actorId_createdAt_idx" ON "RepositoryConnection"("projectId", "actorId", "createdAt");
ALTER TABLE "RepositoryProviderConfiguration" ADD CONSTRAINT "RepositoryProviderConfiguration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepositoryConnection" ADD CONSTRAINT "RepositoryConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepositoryConnection" ADD CONSTRAINT "RepositoryConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepositoryConnection" ADD CONSTRAINT "RepositoryConnection_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepositoryConnection" ADD CONSTRAINT "RepositoryConnection_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "RepositoryProviderConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "RepositoryConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
