-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "datadogWebhookSecret" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "datadogProjectTag" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_datadogProjectTag_key" ON "Project"("organizationId", "datadogProjectTag");

