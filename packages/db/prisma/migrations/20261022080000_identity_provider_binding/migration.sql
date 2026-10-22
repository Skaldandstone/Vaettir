-- No binding, provider connection or permission is created by this migration.
CREATE TABLE "IdentityProviderBinding" (
  "organizationId" TEXT NOT NULL,
  "clerkOrganizationId" TEXT NOT NULL,
  "setupEnabled" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdentityProviderBinding_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "IdentityProviderBinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IdentityProviderBinding_clerkOrganizationId_key" ON "IdentityProviderBinding"("clerkOrganizationId");
