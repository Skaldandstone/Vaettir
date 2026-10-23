CREATE TABLE "ProjectPopulationRequirement" (
 "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "sourceKey" TEXT NOT NULL, "candidateKey" TEXT NOT NULL,
 "sourceVersion" INTEGER NOT NULL, "sourceLine" INTEGER NOT NULL, "sourceQuote" TEXT NOT NULL,
 "approvedTitle" TEXT NOT NULL, "approvedBy" TEXT NOT NULL, "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "requirementId" TEXT REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 PRIMARY KEY ("projectId", "sourceKey", "candidateKey")
);
