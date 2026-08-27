-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "sharedStepGroupId" TEXT;

-- CreateTable
CREATE TABLE "SharedStepGroup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "steps" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedStepGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedStepGroup_projectId_idx" ON "SharedStepGroup"("projectId");

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_sharedStepGroupId_fkey" FOREIGN KEY ("sharedStepGroupId") REFERENCES "SharedStepGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedStepGroup" ADD CONSTRAINT "SharedStepGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedStepGroup" ADD CONSTRAINT "SharedStepGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
