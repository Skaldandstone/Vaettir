ALTER TABLE "Organization" ADD COLUMN "billingFullSeats" INTEGER;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_billingFullSeats_nonnegative" CHECK ("billingFullSeats" IS NULL OR "billingFullSeats" >= 0);

CREATE TABLE "StripeBillingAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "customerId" TEXT,
  "customerStartedAt" TIMESTAMP(3),
  "subscriptionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'none',
  "checkoutKey" TEXT,
  "checkoutSessionId" TEXT,
  "checkoutPriceId" TEXT,
  "checkoutSeats" INTEGER,
  "checkoutStartedAt" TIMESTAMP(3),
  "entitledPlanKey" TEXT,
  "entitledFullSeats" INTEGER NOT NULL DEFAULT 0,
  "syncToken" TEXT,
  "syncUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  CONSTRAINT "StripeBillingAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StripeBillingAccount_organizationId_key" ON "StripeBillingAccount"("organizationId");
CREATE UNIQUE INDEX "StripeBillingAccount_customerId_key" ON "StripeBillingAccount"("customerId");
CREATE UNIQUE INDEX "StripeBillingAccount_subscriptionId_key" ON "StripeBillingAccount"("subscriptionId");
CREATE UNIQUE INDEX "StripeBillingAccount_checkoutKey_key" ON "StripeBillingAccount"("checkoutKey");
CREATE UNIQUE INDEX "StripeBillingAccount_checkoutSessionId_key" ON "StripeBillingAccount"("checkoutSessionId");

CREATE TABLE "StripeBillingEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "environment" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeBillingEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StripeBillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StripeBillingEvent_environment_eventId_key" ON "StripeBillingEvent"("environment", "eventId");
