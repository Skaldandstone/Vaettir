-- CreateTable
CREATE TABLE "TestCaseAttachment" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCaseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestCaseAttachment_testCaseId_idx" ON "TestCaseAttachment"("testCaseId");

-- AddForeignKey
ALTER TABLE "TestCaseAttachment" ADD CONSTRAINT "TestCaseAttachment_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseAttachment" ADD CONSTRAINT "TestCaseAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
