-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_shareToken_key" ON "Requirement"("shareToken");

