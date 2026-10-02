CREATE TABLE "DefectMapState" (
  "projectId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "document" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DefectMapState_pkey" PRIMARY KEY ("projectId")
);
CREATE TABLE "DefectMapWrite" (
  "key" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "appliedVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DefectMapWrite_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "DefectMapWrite_projectId_createdAt_idx" ON "DefectMapWrite"("projectId", "createdAt");
ALTER TABLE "DefectMapState" ADD CONSTRAINT "DefectMapState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DefectMapWrite" ADD CONSTRAINT "DefectMapWrite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DefectMapState"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
