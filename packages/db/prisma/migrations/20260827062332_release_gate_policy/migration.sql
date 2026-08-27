-- CreateEnum
CREATE TYPE "ReleaseGatePolicy" AS ENUM ('SOFT_WARNING', 'HARD_BLOCK');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "releaseGatePolicy" "ReleaseGatePolicy" NOT NULL DEFAULT 'SOFT_WARNING';
