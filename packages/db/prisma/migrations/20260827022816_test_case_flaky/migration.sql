-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "flakyDetectedAt" TIMESTAMP(3),
ADD COLUMN     "isFlaky" BOOLEAN NOT NULL DEFAULT false;
