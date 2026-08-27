-- CreateTable
CREATE TABLE "TestPlanVersion" (
    "id" TEXT NOT NULL,
    "testPlanId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "TestPlanStatus" NOT NULL,
    "customFields" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestPlanVersion_testPlanId_versionNumber_idx" ON "TestPlanVersion"("testPlanId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TestPlanVersion_testPlanId_versionNumber_key" ON "TestPlanVersion"("testPlanId", "versionNumber");

-- AddForeignKey
ALTER TABLE "TestPlanVersion" ADD CONSTRAINT "TestPlanVersion_testPlanId_fkey" FOREIGN KEY ("testPlanId") REFERENCES "TestPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPlanVersion" ADD CONSTRAINT "TestPlanVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
