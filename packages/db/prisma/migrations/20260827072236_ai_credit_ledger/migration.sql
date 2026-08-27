-- CreateEnum
CREATE TYPE "AiCreditTransactionType" AS ENUM ('GRANT', 'CONSUMPTION', 'TOPUP', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "PlanTier" ADD COLUMN     "includedAiCreditsPerMonth" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AiCreditTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "AiCreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "operation" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCreditTransaction_organizationId_createdAt_idx" ON "AiCreditTransaction"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiCreditTransaction" ADD CONSTRAINT "AiCreditTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
