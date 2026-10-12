-- O(1) prefix changes. Do not rewrite TestCase identities, source references,
-- case numbers, version JSON, execution snapshots, counters or prior receipts.
BEGIN;
LOCK TABLE "Project", "TestCase" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE "Project" ADD COLUMN "caseKeyRevision" INTEGER NOT NULL DEFAULT 0
  CHECK ("caseKeyRevision" >= 0);
CREATE UNIQUE INDEX "Project_id_organizationId_key" ON "Project" (id,"organizationId");
CREATE TABLE "ProjectCaseKeyAlias" (
  "projectId" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "caseKey" TEXT NOT NULL CHECK ("caseKey" ~ '^[a-z][a-z0-9-]{0,23}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("projectId","organizationId","caseKey"),
  FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "ProjectCaseKeyAlias_organizationId_caseKey_key"
  ON "ProjectCaseKeyAlias" ("organizationId","caseKey");
CREATE TABLE "ProjectCaseKeyWrite" (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
  "projectId" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL CHECK (length("actorId") BETWEEN 1 AND 200),
  "clerkActorId" TEXT NOT NULL CHECK (length("clerkActorId") BETWEEN 1 AND 200),
  "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "beforeKey" TEXT NOT NULL CHECK ("beforeKey" ~ '^[a-z][a-z0-9-]{0,23}$'),
  "afterKey" TEXT NOT NULL CHECK ("afterKey" ~ '^[a-z][a-z0-9-]{0,23}$'),
  "beforeRevision" INTEGER NOT NULL CHECK ("beforeRevision" >= 0),
  "afterRevision" INTEGER NOT NULL CHECK ("afterRevision" = "beforeRevision" + CASE WHEN "beforeKey"="afterKey" THEN 0 ELSE 1 END),
  receipt JSONB NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "ProjectCaseKeyWrite_projectId_createdAt_idx" ON "ProjectCaseKeyWrite"("projectId","createdAt");
INSERT INTO "ProjectCaseKeyAlias"("projectId","organizationId","caseKey")
  SELECT id,"organizationId","caseKey" FROM "Project";
-- Preserve every actually stored historical prefix, even if an earlier client
-- left an unusual but valid issued prefix. Any ambiguous org ownership refuses.
INSERT INTO "ProjectCaseKeyAlias"("projectId","organizationId","caseKey")
  SELECT DISTINCT c."projectId",p."organizationId",regexp_replace(c."displayId",'-[0-9]+$','')
  FROM "TestCase" c JOIN "Project" p ON p.id=c."projectId"
  ON CONFLICT ("projectId","organizationId","caseKey") DO NOTHING;

CREATE FUNCTION vaettir_case_key_record_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' OR (EXISTS(SELECT 1 FROM "Project" WHERE id=OLD."projectId")
    AND current_setting('vaettir.project_case_key_erasure',true) IS DISTINCT FROM OLD."organizationId") THEN
    RAISE EXCEPTION 'Issued key aliases and original key receipts cannot be changed or deleted' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "ProjectCaseKeyAlias_immutable" BEFORE UPDATE OR DELETE ON "ProjectCaseKeyAlias"
  FOR EACH ROW EXECUTE FUNCTION vaettir_case_key_record_immutable();
CREATE TRIGGER "ProjectCaseKeyWrite_immutable" BEFORE UPDATE OR DELETE ON "ProjectCaseKeyWrite"
  FOR EACH ROW EXECUTE FUNCTION vaettir_case_key_record_immutable();

-- A marker is not an erasure approval. Even an exact marker cannot commit
-- standalone pruning while both original tenant and parent remain present.
CREATE FUNCTION vaettir_case_key_erasure_committed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM "Project" WHERE id=OLD."projectId")
    AND EXISTS(SELECT 1 FROM "Organization" WHERE id=OLD."organizationId") THEN
    RAISE EXCEPTION 'Key history erasure requires the original organization or parent deletion in this same transaction' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
CREATE CONSTRAINT TRIGGER "ProjectCaseKeyAlias_erasure_committed" AFTER DELETE ON "ProjectCaseKeyAlias"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vaettir_case_key_erasure_committed();
CREATE CONSTRAINT TRIGGER "ProjectCaseKeyWrite_erasure_committed" AFTER DELETE ON "ProjectCaseKeyWrite"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vaettir_case_key_erasure_committed();

CREATE OR REPLACE FUNCTION vaettir_project_case_key() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_key TEXT; suffix INTEGER; request_id TEXT; write_row "ProjectCaseKeyWrite"%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW."nextCaseNumber" < OLD."nextCaseNumber" THEN
      RAISE EXCEPTION 'Allocated case numbers cannot be reused' USING ERRCODE='23514';
    END IF;
    IF NEW."caseKey" IS NOT DISTINCT FROM OLD."caseKey" THEN
      IF NEW."caseKeyRevision" IS DISTINCT FROM OLD."caseKeyRevision" THEN
        RAISE EXCEPTION 'Case key revisions require a reviewed key change' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    request_id := current_setting('vaettir.project_case_key_request',true);
    SELECT * INTO write_row FROM "ProjectCaseKeyWrite" WHERE id=request_id;
    IF NOT FOUND OR write_row."projectId"<>OLD.id OR write_row."organizationId"<>OLD."organizationId"
      OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR write_row."beforeKey"<>OLD."caseKey" OR write_row."afterKey"<>NEW."caseKey"
      OR write_row."beforeRevision"<>OLD."caseKeyRevision" OR write_row."afterRevision"<>NEW."caseKeyRevision"
      OR NEW."caseKeyRevision"<>OLD."caseKeyRevision"+1 OR NEW."nextCaseNumber"<>OLD."nextCaseNumber" THEN
      RAISE EXCEPTION 'Use an original reviewed key change with its exact revision and receipt' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."nextCaseNumber"<>0 OR NEW."caseKeyRevision"<>0 THEN
    RAISE EXCEPTION 'Case counters and key revisions are assigned by the database' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('vaettir-case-key:'||NEW."organizationId"));
  IF NEW."caseKey"='' THEN
    base_key:=left(regexp_replace(lower(NEW.slug),'[^a-z0-9]','','g'),20);
    IF base_key='' THEN base_key:='project'; END IF;
    IF base_key !~ '^[a-z]' THEN base_key:='p'||base_key; END IF;
    NEW."caseKey":=base_key; suffix:=1;
    WHILE EXISTS(SELECT 1 FROM "ProjectCaseKeyAlias" WHERE "organizationId"=NEW."organizationId" AND "caseKey"=NEW."caseKey") LOOP
      suffix:=suffix+1; NEW."caseKey":=left(base_key,16)||'-'||suffix::text;
    END LOOP;
  END IF;
  IF EXISTS(SELECT 1 FROM "ProjectCaseKeyAlias" WHERE "organizationId"=NEW."organizationId" AND "caseKey"=NEW."caseKey") THEN
    RAISE EXCEPTION 'Project key is already reserved in this workspace' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION vaettir_register_project_case_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    -- Add destination reservations; never UPDATE old tenant aliases or receipts.
    -- Any destination prefix owned by another project aborts the entire move.
    INSERT INTO "ProjectCaseKeyAlias"("projectId","organizationId","caseKey")
      SELECT NEW.id,NEW."organizationId",prefix FROM (
        SELECT DISTINCT "caseKey" AS prefix FROM "ProjectCaseKeyAlias" WHERE "projectId"=NEW.id
        UNION SELECT NEW."caseKey") known
      ON CONFLICT("projectId","organizationId","caseKey") DO NOTHING;
  ELSIF TG_OP='INSERT' OR NEW."caseKey" IS DISTINCT FROM OLD."caseKey" THEN
    INSERT INTO "ProjectCaseKeyAlias"("projectId","organizationId","caseKey")
      VALUES(NEW.id,NEW."organizationId",NEW."caseKey") ON CONFLICT("projectId","organizationId","caseKey") DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Project_register_case_key" AFTER INSERT OR UPDATE ON "Project"
  FOR EACH ROW EXECUTE FUNCTION vaettir_register_project_case_key();

-- This is a live display projection, never an UPDATE of an issued identity.
CREATE FUNCTION vaettir_case_display_label(project_id TEXT,case_number INTEGER)
  RETURNS TEXT LANGUAGE SQL STABLE STRICT AS $$
  SELECT "caseKey"||'-'||lpad(case_number::text,greatest(2,length(case_number::text)),'0')
  FROM "Project" WHERE id=project_id
$$;
COMMIT;
