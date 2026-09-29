CREATE TYPE "ValidationDomain" AS ENUM (
  'SOFTWARE',
  'HARDWARE',
  'SYSTEM_INTEGRATION',
  'HIL',
  'MANUFACTURING',
  'MEDICAL_DEVICE',
  'PHARMA_LAB',
  'OTHER'
);

ALTER TABLE "Release" ADD COLUMN "goals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "TestCase"
  ADD COLUMN "validationDomain" "ValidationDomain" NOT NULL DEFAULT 'SOFTWARE',
  ADD COLUMN "verificationProfile" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "TestRun"
  ADD COLUMN "executionContext" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "TestCaseVersion"
  ADD COLUMN "validationDomain" "ValidationDomain" NOT NULL DEFAULT 'SOFTWARE',
  ADD COLUMN "verificationProfile" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "TestResult"
  ADD COLUMN "observations" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "Project"
  ADD COLUMN "qualityProfile" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "hiddenComplianceFrameworkIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
