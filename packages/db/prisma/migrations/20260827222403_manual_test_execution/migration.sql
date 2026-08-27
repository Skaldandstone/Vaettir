-- AlterEnum
ALTER TYPE "TestResultStatus" ADD VALUE 'BLOCKED';

-- AlterTable
ALTER TABLE "TestResult" ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "manualTestCaseIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
