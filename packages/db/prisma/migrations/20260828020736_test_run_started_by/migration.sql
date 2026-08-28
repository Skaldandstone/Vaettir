-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "startedById" TEXT;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
