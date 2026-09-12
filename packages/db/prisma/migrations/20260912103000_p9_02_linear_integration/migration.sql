-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "linearApiKeyAuthTag" TEXT,
ADD COLUMN     "linearApiKeyIv" TEXT,
ADD COLUMN     "linearEncryptedApiKey" TEXT,
ADD COLUMN     "linearWebhookSecret" TEXT;

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "linearIssueId" TEXT,
ADD COLUMN     "linearStatusName" TEXT,
ADD COLUMN     "linearSyncedAt" TIMESTAMP(3);

