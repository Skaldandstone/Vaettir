-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "digestHourUtc" INTEGER,
ADD COLUMN     "lastDigestSentAt" TIMESTAMP(3),
ADD COLUMN     "slackWebhookUrl" TEXT;
