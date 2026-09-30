ALTER TABLE "TestCase" ADD COLUMN "sortPosition" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "TestCase_id_projectId_key" ON "TestCase"("id", "projectId");

CREATE TABLE "TestCasePrerequisite" (
    "projectId" TEXT NOT NULL,
    "dependentId" TEXT NOT NULL,
    "prerequisiteId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestCasePrerequisite_pkey" PRIMARY KEY ("dependentId", "prerequisiteId"),
    CONSTRAINT "TestCasePrerequisite_not_self" CHECK ("dependentId" <> "prerequisiteId")
);

CREATE INDEX "TestCasePrerequisite_projectId_prerequisiteId_idx" ON "TestCasePrerequisite"("projectId", "prerequisiteId");

ALTER TABLE "TestCasePrerequisite" ADD CONSTRAINT "TestCasePrerequisite_dependentId_projectId_fkey"
    FOREIGN KEY ("dependentId", "projectId") REFERENCES "TestCase"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestCasePrerequisite" ADD CONSTRAINT "TestCasePrerequisite_prerequisiteId_projectId_fkey"
    FOREIGN KEY ("prerequisiteId", "projectId") REFERENCES "TestCase"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TestRun" ADD COLUMN "manualPrerequisites" JSONB NOT NULL DEFAULT '{}';
