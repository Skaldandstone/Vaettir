-- Additive only. Legacy plans/versions retain explicitly unconfigured templates.
ALTER TABLE "TestPlan" ADD COLUMN "executionTemplate" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "TestPlanVersion" ADD COLUMN "executionTemplate" JSONB NOT NULL DEFAULT '{}';
