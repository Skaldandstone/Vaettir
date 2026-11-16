-- Additive: old aggregate-only grants and their withdrawal triggers survive.
CREATE TABLE "AiDisclosureCaseSnapshot" (
  "grantId" TEXT PRIMARY KEY REFERENCES "AiDisclosureGrant"(id) ON DELETE RESTRICT,
  digest TEXT NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  selection JSONB NOT NULL CHECK (jsonb_typeof(selection)='object' AND octet_length(selection::text)<=8192
    AND selection - ARRAY['organizationId','projectId','caseIds','fields'] = '{}'::jsonb),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER "AiDisclosureCaseSnapshot_immutable" BEFORE UPDATE OR DELETE ON "AiDisclosureCaseSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "rejectAiDisclosureHistoryMutation"();

ALTER TABLE "AiDisclosureGrant" DROP CONSTRAINT "ai_grant_scope_check";
ALTER TABLE "AiDisclosureGrant" ADD CONSTRAINT "ai_grant_scope_check"
  CHECK (recipient='codex' AND scope IN ('aggregate_counts','approved_case_snapshot') AND role='VIEWER'
    AND "policyVersion"=1 AND "classificationVersion">0 AND version>0
    AND "tokenHash" ~ '^[a-f0-9]{64}$' AND "keyHint" ~ '^vai_[a-f0-9]{8}$'
    AND "readWindowCount">=0 AND "expiresAt">"createdAt");
