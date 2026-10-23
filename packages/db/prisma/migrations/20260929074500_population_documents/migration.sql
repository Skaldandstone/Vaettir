CREATE TABLE "ProjectPopulationDocument" (
 "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "sourceKey" TEXT NOT NULL, "version" INTEGER NOT NULL CHECK ("version" > 0),
 "title" TEXT NOT NULL, "content" TEXT NOT NULL, "contentHash" TEXT NOT NULL,
 "approvedBy" TEXT NOT NULL, "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("projectId", "sourceKey")
);
CREATE TABLE "ProjectPopulationDocumentRun" (
 "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "requestId" TEXT NOT NULL, "sourceKey" TEXT NOT NULL,
 "expectedVersion" INTEGER NOT NULL CHECK ("expectedVersion" >= 0),
 "title" TEXT NOT NULL, "content" TEXT NOT NULL, "contentHash" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "approvedAt" TIMESTAMP(3), "appliedVersion" INTEGER, "cancelledAt" TIMESTAMP(3),
 PRIMARY KEY ("projectId", "requestId")
);
