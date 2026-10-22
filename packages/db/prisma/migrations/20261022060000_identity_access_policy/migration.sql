-- No implicit publication, memberships, seats or provider activation.
CREATE TABLE "IdentityAccessPolicy" (
  "organizationId" TEXT NOT NULL PRIMARY KEY REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "sourceDraftRevision" INTEGER NOT NULL CHECK ("sourceDraftRevision" > 0),
  "configuration" JSONB NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
