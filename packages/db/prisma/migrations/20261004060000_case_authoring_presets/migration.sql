-- Additive authoring scaffolds, not plan configurations or approved protocols.
CREATE TABLE "CaseAuthoringPreset" (
  id TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectId" TEXT NOT NULL REFERENCES "Project"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdById" TEXT NOT NULL,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  definition JSONB NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=262144),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 1000000),
  "archivedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "CaseAuthoringPreset_projectId_name_key" ON "CaseAuthoringPreset"("projectId",name);
CREATE INDEX "CaseAuthoringPreset_scope_idx" ON "CaseAuthoringPreset"("organizationId","projectId","archivedAt",name);
CREATE TABLE "CaseAuthoringPresetWrite" (
  id TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectId" TEXT NOT NULL REFERENCES "Project"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "presetId" TEXT NOT NULL REFERENCES "CaseAuthoringPreset"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorId" TEXT NOT NULL,"requestId" TEXT NOT NULL,"requestHash" TEXT NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
  receipt JSONB NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=1048576),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CaseAuthoringPresetWrite_projectId_actorId_requestId_key" ON "CaseAuthoringPresetWrite"("projectId","actorId","requestId");
CREATE INDEX "CaseAuthoringPresetWrite_scope_idx" ON "CaseAuthoringPresetWrite"("organizationId","projectId","presetId","createdAt");
CREATE FUNCTION vaettir_case_authoring_preset_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('vaettir.case_authoring_preset_erasure',true)=OLD."organizationId" THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Case authoring preset receipts are append-only; only explicit original-organization erasure may delete them';
END $$;
CREATE TRIGGER "CaseAuthoringPresetWrite_immutable" BEFORE UPDATE OR DELETE ON "CaseAuthoringPresetWrite" FOR EACH ROW EXECUTE FUNCTION vaettir_case_authoring_preset_receipt_guard();
CREATE FUNCTION vaettir_case_authoring_preset_receipt_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE preset "CaseAuthoringPreset"%ROWTYPE; previous JSONB;
BEGIN
  SELECT * INTO preset FROM "CaseAuthoringPreset" WHERE id=NEW."presetId" AND "projectId"=NEW."projectId" AND "organizationId"=NEW."organizationId" FOR UPDATE;
  IF NOT FOUND OR NEW.receipt->>'schemaVersion' IS DISTINCT FROM '1' OR NEW.receipt->>'organizationId' IS DISTINCT FROM NEW."organizationId" OR NEW.receipt->>'projectId' IS DISTINCT FROM NEW."projectId" OR NEW.receipt->>'actorId' IS DISTINCT FROM NEW."actorId" OR NEW.receipt->'after'->>'presetId' IS DISTINCT FROM preset.id OR NEW.receipt->'after'->>'name' IS DISTINCT FROM preset.name OR NEW.receipt->'after'->>'version' IS DISTINCT FROM preset.version::text OR NEW.receipt->'after'->'archived' IS DISTINCT FROM to_jsonb(preset."archivedAt" IS NOT NULL) OR NEW.receipt->'after'->'definition' IS DISTINCT FROM preset.definition THEN
    RAISE EXCEPTION 'Preset receipt must exactly describe its current same-scope head';
  END IF;
  IF EXISTS(SELECT 1 FROM "CaseAuthoringPresetWrite" WHERE "presetId"=preset.id AND receipt->'after'->>'version'=preset.version::text) THEN RAISE EXCEPTION 'Preset revision already has its immutable receipt'; END IF;
  IF preset.version=1 THEN
    IF NEW.receipt->>'operation' IS DISTINCT FROM 'CREATE' OR NEW.receipt->'before' IS DISTINCT FROM 'null'::jsonb OR EXISTS(SELECT 1 FROM "CaseAuthoringPresetWrite" WHERE "presetId"=preset.id) THEN RAISE EXCEPTION 'Initial preset receipt must describe a new stable identity'; END IF;
  ELSE
    SELECT receipt->'after' INTO previous FROM "CaseAuthoringPresetWrite" WHERE "presetId"=preset.id AND "projectId"=NEW."projectId" AND "organizationId"=NEW."organizationId" AND receipt->'after'->>'version'=(preset.version-1)::text;
    IF previous IS NULL OR NEW.receipt->'before' IS DISTINCT FROM previous THEN RAISE EXCEPTION 'Preset receipt must retain the exact prior recorded revision'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CaseAuthoringPresetWrite_scope_and_head" BEFORE INSERT ON "CaseAuthoringPresetWrite" FOR EACH ROW EXECUTE FUNCTION vaettir_case_authoring_preset_receipt_insert_guard();
