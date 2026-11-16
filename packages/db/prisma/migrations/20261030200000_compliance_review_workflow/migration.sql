-- Additive: legacy global definitions keep their original IDs and remain unowned.
ALTER TABLE "ComplianceFramework" ADD COLUMN "organizationId" TEXT REFERENCES "Organization"(id), ADD COLUMN "catalogKey" TEXT, ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "ComplianceFramework_organizationId_idx" ON "ComplianceFramework"("organizationId");
CREATE UNIQUE INDEX "ComplianceFramework_organization_catalog_key" ON "ComplianceFramework"("organizationId","catalogKey");
ALTER TABLE "ComplianceControl" ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TestCase" ADD COLUMN "complianceRevision" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "ComplianceReviewDraft" (
 id TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"(id) ON DELETE RESTRICT,
 "organizationId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "clerkActorId" TEXT NOT NULL,
 "authorityGeneration" INTEGER NOT NULL DEFAULT 0, "revokedAt" TIMESTAMP(3),
 "requestHash" TEXT NOT NULL, "sourceDigest" TEXT NOT NULL, snapshot JSONB NOT NULL, selection JSONB NOT NULL,
 digest TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','APPLIED')),
 receipt JSONB, "applyRequestId" TEXT, "applyHash" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(octet_length(snapshot::text)<=8388608), CHECK(octet_length(selection::text)<=1048576)
);
CREATE INDEX "ComplianceReviewDraft_projectId_actorId_createdAt_idx" ON "ComplianceReviewDraft"("projectId","actorId","createdAt");
CREATE FUNCTION vaettir_compliance_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision=OLD.revision+1; RETURN NEW; END $$;
CREATE TRIGGER compliance_framework_revision BEFORE UPDATE ON "ComplianceFramework" FOR EACH ROW EXECUTE FUNCTION vaettir_compliance_revision();
CREATE TRIGGER compliance_control_revision BEFORE UPDATE ON "ComplianceControl" FOR EACH ROW EXECUTE FUNCTION vaettir_compliance_revision();
CREATE FUNCTION vaettir_compliance_case_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW."complianceRevision"=OLD."complianceRevision"+1; RETURN NEW; END $$;
CREATE TRIGGER compliance_case_revision BEFORE UPDATE ON "TestCase" FOR EACH ROW EXECUTE FUNCTION vaettir_compliance_case_revision();
CREATE FUNCTION vaettir_compliance_step_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN UPDATE "TestCase" SET "complianceRevision"="complianceRevision"+1 WHERE id=OLD."testCaseId"; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW."testCaseId" IS DISTINCT FROM OLD."testCaseId") THEN
 UPDATE "TestCase" SET "complianceRevision"="complianceRevision"+1 WHERE id=NEW."testCaseId"; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER compliance_step_revision AFTER INSERT OR UPDATE OR DELETE ON "TestCaseStep" FOR EACH ROW EXECUTE FUNCTION vaettir_compliance_step_revision();
CREATE FUNCTION vaettir_revoke_compliance_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='Membership' THEN
    IF TG_OP='DELETE' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW."seatType" IS DISTINCT FROM OLD."seatType" THEN
      UPDATE "ComplianceReviewDraft" SET "authorityGeneration"="authorityGeneration"+1, "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP)
        WHERE "organizationId"=OLD."organizationId" AND "actorId"=OLD."userId";
    END IF;
  ELSIF TG_TABLE_NAME='Organization' THEN
    IF NEW."suspendedAt" IS DISTINCT FROM OLD."suspendedAt" AND NEW."suspendedAt" IS NOT NULL THEN
      UPDATE "ComplianceReviewDraft" SET "authorityGeneration"="authorityGeneration"+1, "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP) WHERE "organizationId"=OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME='Project' THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
      UPDATE "ComplianceReviewDraft" SET "authorityGeneration"="authorityGeneration"+1, "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP) WHERE "projectId"=OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME='User' THEN
    IF NEW."clerkUserId" IS DISTINCT FROM OLD."clerkUserId" THEN
      UPDATE "ComplianceReviewDraft" SET "authorityGeneration"="authorityGeneration"+1, "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP) WHERE "actorId"=OLD.id;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER compliance_review_membership_revoke AFTER UPDATE OR DELETE ON "Membership" FOR EACH ROW EXECUTE FUNCTION vaettir_revoke_compliance_review();
CREATE TRIGGER compliance_review_suspension_revoke AFTER UPDATE OF "suspendedAt" ON "Organization" FOR EACH ROW EXECUTE FUNCTION vaettir_revoke_compliance_review();
CREATE TRIGGER compliance_review_project_revoke AFTER UPDATE OF "organizationId" ON "Project" FOR EACH ROW EXECUTE FUNCTION vaettir_revoke_compliance_review();
CREATE TRIGGER compliance_review_actor_revoke AFTER UPDATE OF "clerkUserId" ON "User" FOR EACH ROW EXECUTE FUNCTION vaettir_revoke_compliance_review();

-- Existing direct mapping paths also invalidate retained source versions.
CREATE TRIGGER compliance_mapping_revision AFTER INSERT OR UPDATE OR DELETE ON "TestCaseComplianceControl" FOR EACH ROW EXECUTE FUNCTION vaettir_compliance_step_revision();
CREATE FUNCTION vaettir_compliance_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."catalogKey" IS DISTINCT FROM OLD."catalogKey" THEN
 RAISE EXCEPTION 'Compliance ownership is immutable; explicitly copy reviewed definitions instead of claiming legacy global ownership'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER compliance_owner_guard BEFORE UPDATE ON "ComplianceFramework" FOR EACH ROW EXECUTE FUNCTION vaettir_compliance_owner_guard();

CREATE FUNCTION vaettir_compliance_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW."projectId",NEW."organizationId",NEW."actorId",NEW."clerkActorId",NEW."requestHash",NEW."sourceDigest",NEW.snapshot,NEW."createdAt")
 IS DISTINCT FROM (OLD.id,OLD."projectId",OLD."organizationId",OLD."actorId",OLD."clerkActorId",OLD."requestHash",OLD."sourceDigest",OLD.snapshot,OLD."createdAt") THEN
 RAISE EXCEPTION 'Compliance review source and original scope are immutable'; END IF;
 IF OLD.state='APPLIED' AND (NEW.state,NEW.selection,NEW.digest,NEW.receipt,NEW."applyRequestId",NEW."applyHash") IS DISTINCT FROM (OLD.state,OLD.selection,OLD.digest,OLD.receipt,OLD."applyRequestId",OLD."applyHash") THEN
 RAISE EXCEPTION 'Applied compliance receipt is immutable'; END IF;
 IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN RAISE EXCEPTION 'Compliance authority cannot be restored'; END IF;
 IF NEW."authorityGeneration"<OLD."authorityGeneration" THEN RAISE EXCEPTION 'Compliance authority cannot move backwards'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER compliance_draft_guard BEFORE UPDATE ON "ComplianceReviewDraft" FOR EACH ROW EXECUTE FUNCTION vaettir_compliance_draft_guard();
