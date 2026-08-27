-- CreateTable
CREATE TABLE "TestCaseVersion" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "background" TEXT,
    "given" TEXT[],
    "when" TEXT[],
    "then" TEXT[],
    "steps" JSONB NOT NULL,
    "tags" TEXT[],
    "priority" "TestCasePriority" NOT NULL,
    "testType" "TestCaseType" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCaseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestCaseVersion_testCaseId_versionNumber_idx" ON "TestCaseVersion"("testCaseId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseVersion_testCaseId_versionNumber_key" ON "TestCaseVersion"("testCaseId", "versionNumber");

-- AddForeignKey
ALTER TABLE "TestCaseVersion" ADD CONSTRAINT "TestCaseVersion_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseVersion" ADD CONSTRAINT "TestCaseVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
