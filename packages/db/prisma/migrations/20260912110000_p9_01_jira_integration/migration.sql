-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "jiraApiTokenAuthTag" TEXT,
ADD COLUMN     "jiraApiTokenIv" TEXT,
ADD COLUMN     "jiraBaseUrl" TEXT,
ADD COLUMN     "jiraEmail" TEXT,
ADD COLUMN     "jiraEncryptedApiToken" TEXT,
ADD COLUMN     "jiraWebhookSecret" TEXT;

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "jiraIssueKey" TEXT,
ADD COLUMN     "jiraStatusName" TEXT,
ADD COLUMN     "jiraSyncedAt" TIMESTAMP(3);

