-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "slackEventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];
