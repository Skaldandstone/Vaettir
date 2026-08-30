ALTER TABLE "PlanTier" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AiCreditTransaction" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "AiCreditTransaction_organizationId_idempotencyKey_key"
ON "AiCreditTransaction"("organizationId", "idempotencyKey");

CREATE TABLE "BetaEnrollment" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "organizationId" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  CONSTRAINT "BetaEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BetaEnrollment_email_key" ON "BetaEnrollment"("email");
CREATE UNIQUE INDEX "BetaEnrollment_organizationId_key" ON "BetaEnrollment"("organizationId");
ALTER TABLE "BetaEnrollment" ADD CONSTRAINT "BetaEnrollment_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PlanTier" ("id", "key", "name", "sortOrder", "isPublic", "minFullSeats", "maxFullSeats", "includedReadOnlySeats", "maxReadOnlySeats", "monthlyPricePerSeatCents", "includedAiCreditsPerMonth", "enabledFeatures")
VALUES ('vaettir-private-beta-v1', 'private-beta', 'Private beta', 100, false, 1, 5, 2, 2, 0, 500, ARRAY[]::TEXT[]);
