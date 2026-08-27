-- CreateTable
CREATE TABLE "TestCaseDataset" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "parameterNames" TEXT[],
    "rows" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCaseDataset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseDataset_testCaseId_key" ON "TestCaseDataset"("testCaseId");

-- AddForeignKey
ALTER TABLE "TestCaseDataset" ADD CONSTRAINT "TestCaseDataset_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
