CREATE TABLE "ProjectPopulationDraft" (
  "projectId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "document" JSONB NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectPopulationDraft_pkey" PRIMARY KEY ("projectId"),
  CONSTRAINT "ProjectPopulationDraft_version_check" CHECK ("version" > 0)
);
CREATE TABLE "ProjectPopulationDraftWrite" (
  "projectId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "appliedVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectPopulationDraftWrite_pkey" PRIMARY KEY ("projectId", "requestId")
);
ALTER TABLE "ProjectPopulationDraft" ADD CONSTRAINT "ProjectPopulationDraft_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectPopulationDraftWrite" ADD CONSTRAINT "ProjectPopulationDraftWrite_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
