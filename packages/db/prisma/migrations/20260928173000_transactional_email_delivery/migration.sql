CREATE TYPE "TransactionalEmailStatus" AS ENUM ('RECEIVED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN');

CREATE TABLE "TransactionalEmailDelivery" (
    "id" TEXT NOT NULL,
    "clerkEmailId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "templateSlug" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "recipientDomain" TEXT NOT NULL,
    "status" "TransactionalEmailStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionalEmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransactionalEmailDelivery_clerkEmailId_key" ON "TransactionalEmailDelivery"("clerkEmailId");
CREATE UNIQUE INDEX "TransactionalEmailDelivery_webhookId_key" ON "TransactionalEmailDelivery"("webhookId");
CREATE UNIQUE INDEX "TransactionalEmailDelivery_providerMessageId_key" ON "TransactionalEmailDelivery"("providerMessageId");
CREATE INDEX "TransactionalEmailDelivery_status_updatedAt_idx" ON "TransactionalEmailDelivery"("status", "updatedAt");
