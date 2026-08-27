-- CreateEnum
CREATE TYPE "PrScanCommentMode" AS ENUM ('COMMENT', 'SILENT_FLAG_ONLY');

-- CreateTable
CREATE TABLE "PrScanPolicy" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "triggerBranches" TEXT[] DEFAULT ARRAY['main']::TEXT[],
    "commentMode" "PrScanCommentMode" NOT NULL DEFAULT 'COMMENT',
    "pathSeverityRules" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrScanPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrScanPolicy_projectId_key" ON "PrScanPolicy"("projectId");

-- AddForeignKey
ALTER TABLE "PrScanPolicy" ADD CONSTRAINT "PrScanPolicy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
