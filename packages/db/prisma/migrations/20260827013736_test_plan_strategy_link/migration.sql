-- AlterTable
ALTER TABLE "TestPlan" ADD COLUMN     "strategyId" TEXT;

-- AddForeignKey
ALTER TABLE "TestPlan" ADD CONSTRAINT "TestPlan_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "TestPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
