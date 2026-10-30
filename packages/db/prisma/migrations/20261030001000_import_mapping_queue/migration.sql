CREATE TABLE "ImportMappingBatch" (
  id TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "organizationId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "clerkActorId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL, "sourceLabel" TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','CONFIRMED','CANCELLED')),
  "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3)
);
CREATE INDEX "ImportMappingBatch_projectId_actorId_createdAt_idx" ON "ImportMappingBatch"("projectId","actorId","createdAt");
CREATE TABLE "ImportMappingRow" (
  id TEXT PRIMARY KEY, "batchId" TEXT NOT NULL REFERENCES "ImportMappingBatch"(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, sheet TEXT NOT NULL, "sourceRowNumber" INTEGER NOT NULL,
  "originalRowNumber" INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('READY','MAPPING','CONTEXT','IMPORTED','HISTORY')),
  candidate JSONB NOT NULL, original JSONB NOT NULL, reasons TEXT[] NOT NULL,
  "hasHistory" BOOLEAN NOT NULL, "keyPrefix" TEXT NOT NULL, "externalIdPrefix" TEXT NOT NULL, framework TEXT NOT NULL,
  "caseId" TEXT, "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ImportMappingRow_batchId_ordinal_key" UNIQUE("batchId",ordinal),
  CONSTRAINT "ImportMappingRow_payload_limit" CHECK(octet_length(candidate::text)+octet_length(original::text)<=2097152)
);
CREATE INDEX "ImportMappingRow_batchId_state_idx" ON "ImportMappingRow"("batchId",state);
CREATE TABLE "ImportMappingWrite" (
  id TEXT PRIMARY KEY, "batchId" TEXT NOT NULL REFERENCES "ImportMappingBatch"(id) ON DELETE CASCADE,
  "requestHash" TEXT NOT NULL, receipt JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A retained import request never survives a reduction or change-and-restore.
-- No other job, actor, membership or customer configuration is modified.
CREATE FUNCTION vaettir_revoke_import_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='Membership' THEN
    IF TG_OP='DELETE' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW."seatType" IS DISTINCT FROM OLD."seatType" THEN
      UPDATE "ImportMappingBatch" SET "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP)
        WHERE "organizationId"=OLD."organizationId" AND "actorId"=OLD."userId";
    END IF;
  ELSIF TG_TABLE_NAME='Organization' THEN
    IF NEW."suspendedAt" IS DISTINCT FROM OLD."suspendedAt" AND NEW."suspendedAt" IS NOT NULL THEN
      UPDATE "ImportMappingBatch" SET "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP) WHERE "organizationId"=OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME='Project' THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
      UPDATE "ImportMappingBatch" SET "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP) WHERE "projectId"=OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME='User' THEN
    IF NEW."clerkUserId" IS DISTINCT FROM OLD."clerkUserId" THEN
      UPDATE "ImportMappingBatch" SET "revokedAt"=COALESCE("revokedAt",CURRENT_TIMESTAMP) WHERE "actorId"=OLD.id;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER import_mapping_membership_revoke AFTER UPDATE OR DELETE ON "Membership" FOR EACH ROW EXECUTE FUNCTION vaettir_revoke_import_mapping();
CREATE TRIGGER import_mapping_suspension_revoke AFTER UPDATE OF "suspendedAt" ON "Organization" FOR EACH ROW EXECUTE FUNCTION vaettir_revoke_import_mapping();
CREATE TRIGGER import_mapping_project_revoke AFTER UPDATE OF "organizationId" ON "Project" FOR EACH ROW EXECUTE FUNCTION vaettir_revoke_import_mapping();
CREATE TRIGGER import_mapping_actor_revoke AFTER UPDATE OF "clerkUserId" ON "User" FOR EACH ROW EXECUTE FUNCTION vaettir_revoke_import_mapping();
