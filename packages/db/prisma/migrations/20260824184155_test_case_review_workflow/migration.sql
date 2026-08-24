-- CreateEnum
CREATE TYPE "TestCaseReviewStatus" AS ENUM ('APPROVED', 'PENDING_REVIEW', 'REJECTED');

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewStatus" "TestCaseReviewStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
