ALTER TABLE "Invitation"
  ADD COLUMN "emailStatus" "TransactionalEmailStatus" NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN "emailAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "emailSentAt" TIMESTAMP(3),
  ADD COLUMN "emailMessageId" TEXT;
