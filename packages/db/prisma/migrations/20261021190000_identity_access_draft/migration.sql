-- Preparation only: no membership, session, seat or authorization changes.
CREATE TABLE "IdentityAccessDraft" (
  "organizationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "configuration" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdentityAccessDraft_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "IdentityAccessDraft_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
