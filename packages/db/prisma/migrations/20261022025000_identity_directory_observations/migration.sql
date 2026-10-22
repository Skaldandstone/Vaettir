-- Additive, inactive source journal. No existing roles, seats or grants are changed.
CREATE TABLE "IdentityDirectoryConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "providerInstanceId" TEXT NOT NULL,
  "providerConnectionId" TEXT NOT NULL,
  "providerDirectoryId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "observationLeaseSeconds" INTEGER NOT NULL DEFAULT 300 CHECK ("observationLeaseSeconds" BETWEEN 1 AND 3600),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "IdentityDirectoryConnection_organizationId_id_key" ON "IdentityDirectoryConnection"("organizationId", "id");
CREATE UNIQUE INDEX "IdentityDirectoryConnection_provider_directory_key" ON "IdentityDirectoryConnection"("providerInstanceId", "providerDirectoryId");

CREATE TABLE "IdentityDirectorySubject" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clerkSubject" TEXT NOT NULL,
  "externalSubjectId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "requestedGeneration" INTEGER NOT NULL DEFAULT 0,
  "appliedGeneration" INTEGER NOT NULL DEFAULT 0,
  "observedConnectionRevision" INTEGER,
  "observedSubjectRevision" INTEGER,
  "reservedAt" TIMESTAMP(3),
  "reservedUntil" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT false,
  "externalGroupIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "observedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdentityDirectorySubject_generation_check" CHECK ("requestedGeneration" >= "appliedGeneration" AND "appliedGeneration" >= 0),
  CONSTRAINT "IdentityDirectorySubject_reservation_check" CHECK (
    ("requestedGeneration" = 0 AND "reservedAt" IS NULL AND "reservedUntil" IS NULL)
    OR ("requestedGeneration" > 0 AND "reservedAt" IS NOT NULL AND "reservedUntil" IS NOT NULL AND "reservedUntil" > "reservedAt")
  ),
  CONSTRAINT "IdentityDirectorySubject_observation_check" CHECK (
    ("appliedGeneration" = 0 AND NOT "active" AND cardinality("externalGroupIds") = 0 AND "observedAt" IS NULL AND "expiresAt" IS NULL AND "observedConnectionRevision" IS NULL AND "observedSubjectRevision" IS NULL)
    OR ("appliedGeneration" > 0 AND "observedAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "expiresAt" > "observedAt" AND "observedConnectionRevision" IS NOT NULL AND "observedConnectionRevision" > 0 AND "observedSubjectRevision" IS NOT NULL AND "observedSubjectRevision" > 0)
  ),
  CONSTRAINT "IdentityDirectorySubject_inactive_groups_check" CHECK ("active" OR cardinality("externalGroupIds") = 0),
  CONSTRAINT "IdentityDirectorySubject_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId", "connectionId") REFERENCES "IdentityDirectoryConnection"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "IdentityDirectorySubject_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "Membership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IdentityDirectorySubject_organizationId_id_key" ON "IdentityDirectorySubject"("organizationId", "id");
CREATE UNIQUE INDEX "IdentityDirectorySubject_external_subject_key" ON "IdentityDirectorySubject"("organizationId", "connectionId", "externalSubjectId");
CREATE UNIQUE INDEX "IdentityDirectorySubject_organizationId_connectionId_userId_key" ON "IdentityDirectorySubject"("organizationId", "connectionId", "userId");

CREATE TABLE "IdentityDirectoryReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL CHECK ("generation" > 0),
  "connectionRevision" INTEGER NOT NULL CHECK ("connectionRevision" > 0),
  "subjectRevision" INTEGER NOT NULL CHECK ("subjectRevision" > 0),
  "providerInstanceId" TEXT NOT NULL,
  "providerConnectionId" TEXT NOT NULL,
  "providerDirectoryId" TEXT NOT NULL,
  "externalSubjectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clerkSubject" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL,
  "groupCount" INTEGER NOT NULL CHECK ("groupCount" >= 0 AND ("active" OR "groupCount" = 0)),
  "externalGroupIds" TEXT[] NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL CHECK ("expiresAt" > "observedAt"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdentityDirectoryReceipt_group_count_check" CHECK (cardinality("externalGroupIds") = "groupCount"),
  CONSTRAINT "IdentityDirectoryReceipt_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "IdentityDirectorySubject"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IdentityDirectoryReceipt_subjectId_generation_key" ON "IdentityDirectoryReceipt"("subjectId", "generation");
CREATE INDEX "IdentityDirectoryReceipt_organizationId_createdAt_idx" ON "IdentityDirectoryReceipt"("organizationId", "createdAt");
