-- DropForeignKey
ALTER TABLE "TestCaseSource" DROP CONSTRAINT "TestCaseSource_testCaseId_fkey";

-- DropForeignKey
ALTER TABLE "TestCaseStep" DROP CONSTRAINT "TestCaseStep_testCaseId_fkey";

-- AddForeignKey
ALTER TABLE "TestCaseStep" ADD CONSTRAINT "TestCaseStep_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseSource" ADD CONSTRAINT "TestCaseSource_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
