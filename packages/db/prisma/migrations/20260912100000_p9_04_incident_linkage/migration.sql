-- AlterEnum
ALTER TYPE "RiskSource" ADD VALUE 'PRODUCTION_INCIDENT';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "pagerdutyServiceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_pagerdutyServiceId_key" ON "Project"("pagerdutyServiceId");

