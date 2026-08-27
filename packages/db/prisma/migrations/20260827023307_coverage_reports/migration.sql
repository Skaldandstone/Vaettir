-- CreateEnum
CREATE TYPE "CoverageTool" AS ENUM ('ISTANBUL', 'COBERTURA', 'JACOCO');

-- CreateTable
CREATE TABLE "CoverageReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "testRunId" TEXT,
    "commitSha" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "tool" "CoverageTool" NOT NULL,
    "linesCovered" INTEGER NOT NULL,
    "linesTotal" INTEGER NOT NULL,
    "branchesCovered" INTEGER,
    "branchesTotal" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageFileEntry" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "linesCovered" INTEGER NOT NULL,
    "linesTotal" INTEGER NOT NULL,
    "branchesCovered" INTEGER,
    "branchesTotal" INTEGER,

    CONSTRAINT "CoverageFileEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoverageReport_testRunId_key" ON "CoverageReport"("testRunId");

-- CreateIndex
CREATE INDEX "CoverageReport_projectId_createdAt_idx" ON "CoverageReport"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "CoverageFileEntry_reportId_idx" ON "CoverageFileEntry"("reportId");

-- CreateIndex
CREATE INDEX "CoverageFileEntry_filePath_idx" ON "CoverageFileEntry"("filePath");

-- AddForeignKey
ALTER TABLE "CoverageReport" ADD CONSTRAINT "CoverageReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageReport" ADD CONSTRAINT "CoverageReport_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageFileEntry" ADD CONSTRAINT "CoverageFileEntry_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CoverageReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
