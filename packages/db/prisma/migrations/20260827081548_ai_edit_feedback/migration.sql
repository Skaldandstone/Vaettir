-- CreateTable
CREATE TABLE "AiEditFeedback" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "beforeTitle" TEXT NOT NULL,
    "beforeGiven" TEXT[],
    "beforeWhen" TEXT[],
    "beforeThen" TEXT[],
    "afterTitle" TEXT NOT NULL,
    "afterGiven" TEXT[],
    "afterWhen" TEXT[],
    "afterThen" TEXT[],
    "editedById" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEditFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiEditFeedback_projectId_editedAt_idx" ON "AiEditFeedback"("projectId", "editedAt");

-- AddForeignKey
ALTER TABLE "AiEditFeedback" ADD CONSTRAINT "AiEditFeedback_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEditFeedback" ADD CONSTRAINT "AiEditFeedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEditFeedback" ADD CONSTRAINT "AiEditFeedback_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
