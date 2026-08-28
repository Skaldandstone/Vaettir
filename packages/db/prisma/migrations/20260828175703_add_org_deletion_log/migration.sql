-- CreateTable
CREATE TABLE "OrganizationDeletionLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "organizationSlug" TEXT NOT NULL,
    "deletedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rowCounts" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationDeletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationDeletionLog_organizationId_idx" ON "OrganizationDeletionLog"("organizationId");

-- AddForeignKey
ALTER TABLE "OrganizationDeletionLog" ADD CONSTRAINT "OrganizationDeletionLog_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
