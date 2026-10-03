-- Compatible reads, explicit mixed-version write refusal. No prior edit history
-- is fabricated: baseline snapshots capture the content present at migration.
ALTER TABLE "SharedStepGroup" ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SharedStepGroup" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "SharedStepGroup" ADD CONSTRAINT "shared_library_revision_bounds" CHECK (revision BETWEEN 1 AND 100);
CREATE TABLE "SharedStepGroupRevision" (
 id TEXT PRIMARY KEY,
 "groupId" TEXT NOT NULL REFERENCES "SharedStepGroup"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 100),
 kind TEXT NOT NULL CHECK (kind IN ('MIGRATION_BASELINE','BASELINE_CAPTURE','CREATE','UPDATE','RESTORE','ARCHIVE','RECOVER')),
 snapshot JSONB NOT NULL,
 "actorId" TEXT,
 "actorName" TEXT,
 "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reason TEXT,
 "sourceRevision" INTEGER,
 "requestId" TEXT,
 "requestHash" TEXT,
 CONSTRAINT "shared_library_receipt_shape" CHECK (("requestId" IS NULL AND "requestHash" IS NULL) OR ("actorId" IS NOT NULL AND "requestId" IS NOT NULL AND "requestHash" ~ '^[a-f0-9]{64}$'))
);
CREATE UNIQUE INDEX "SharedStepGroupRevision_groupId_revision_key" ON "SharedStepGroupRevision"("groupId",revision);
CREATE UNIQUE INDEX "SharedStepGroupRevision_groupId_actorId_requestId_key" ON "SharedStepGroupRevision"("groupId","actorId","requestId");
CREATE INDEX "SharedStepGroupRevision_groupId_revision_idx" ON "SharedStepGroupRevision"("groupId",revision);
INSERT INTO "SharedStepGroupRevision"(id,"groupId",revision,kind,snapshot,reason)
SELECT 'shared_baseline_'||id,id,1,'MIGRATION_BASELINE',jsonb_build_object('name',name,'description',description,'steps',steps,'archived',false),
 'CURRENT CONTENT CAPTURED AT MIGRATION. Earlier edits and their actors are unknown.' FROM "SharedStepGroup";

-- Transaction-local selectors identify the reviewed application path, not an
-- actor authorization boundary. Current server authorization remains mandatory.
CREATE FUNCTION vaettir_shared_library_erasure(group_id TEXT) RETURNS BOOLEAN LANGUAGE SQL AS $$
 SELECT EXISTS(SELECT 1 FROM "SharedStepGroup" g JOIN "Project" p ON p.id=g."projectId"
 WHERE g.id=group_id AND p."organizationId"=nullif(current_setting('vaettir.shared_library_erasure',true),''));
$$;
CREATE FUNCTION vaettir_shared_library_head_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE context JSONB;
BEGIN
 IF TG_OP='DELETE' THEN
   IF NOT vaettir_shared_library_erasure(OLD.id) THEN RAISE EXCEPTION 'Step libraries retain history; use reviewed archive.' USING ERRCODE='23514'; END IF;
   RETURN OLD;
 END IF;
 IF (OLD.id,OLD."projectId") IS DISTINCT FROM (NEW.id,NEW."projectId") THEN RAISE EXCEPTION 'Library identity and project are immutable.' USING ERRCODE='23514'; END IF;
 IF (OLD.name,OLD.description,OLD.steps,OLD."archivedAt",OLD.revision) IS NOT DISTINCT FROM (NEW.name,NEW.description,NEW.steps,NEW."archivedAt",NEW.revision) THEN RETURN NEW; END IF;
 context := nullif(current_setting('vaettir.shared_step_write',true),'')::jsonb;
 IF context IS NULL OR context->>'id' IS DISTINCT FROM OLD.id OR NEW.revision<>OLD.revision+1 OR
    nullif(context->>'actorId','') IS NULL OR nullif(context->>'actorName','') IS NULL OR
    nullif(context->>'requestId','') IS NULL OR (context->>'requestHash') IS NULL OR
    (context->>'requestHash') !~ '^[a-f0-9]{64}$' OR
    context->>'kind' NOT IN ('UPDATE','RESTORE','ARCHIVE','RECOVER') OR
    nullif(context->>'reason','') IS NULL THEN
   RAISE EXCEPTION 'Library content requires a compatible reviewed writer and a new revision.' USING ERRCODE='23514';
 END IF;
 IF NEW."archivedAt" IS NOT NULL AND OLD."archivedAt" IS NULL AND EXISTS(SELECT 1 FROM "TestCase" WHERE "sharedStepGroupId"=OLD.id) THEN
   RAISE EXCEPTION 'Unlink cases before archiving their library.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER shared_library_head_guard BEFORE UPDATE OR DELETE ON "SharedStepGroup" FOR EACH ROW EXECUTE FUNCTION vaettir_shared_library_head_guard();

CREATE FUNCTION vaettir_shared_library_baseline() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE context JSONB;
BEGIN
 context := nullif(current_setting('vaettir.shared_step_create',true),'')::jsonb;
 IF context IS NOT NULL AND context->>'id' IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'Creation receipt does not match this library.' USING ERRCODE='23514'; END IF;
 INSERT INTO "SharedStepGroupRevision"(id,"groupId",revision,kind,snapshot,"actorId","actorName","requestId","requestHash",reason)
 VALUES('shared_baseline_'||NEW.id,NEW.id,1,CASE WHEN context IS NULL THEN 'BASELINE_CAPTURE' ELSE 'CREATE' END,
 jsonb_build_object('name',NEW.name,'description',NEW.description,'steps',NEW.steps,'archived',NEW."archivedAt" IS NOT NULL),
 context->>'actorId',context->>'actorName',context->>'requestId',context->>'requestHash',
 CASE WHEN context IS NULL THEN 'Current content captured. Original actor and earlier history are unknown.' ELSE NULL END);
 RETURN NEW;
END; $$;
CREATE TRIGGER shared_library_baseline AFTER INSERT ON "SharedStepGroup" FOR EACH ROW EXECUTE FUNCTION vaettir_shared_library_baseline();

CREATE FUNCTION vaettir_shared_library_history_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE head "SharedStepGroup";
BEGIN
 IF TG_OP='DELETE' AND vaettir_shared_library_erasure(OLD."groupId") THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Saved library revisions and receipts are append-only.' USING ERRCODE='23514'; END IF;
 SELECT * INTO head FROM "SharedStepGroup" WHERE id=NEW."groupId";
 IF NEW.revision<>head.revision OR NEW.snapshot<>jsonb_build_object('name',head.name,'description',head.description,'steps',head.steps,'archived',head."archivedAt" IS NOT NULL) THEN
   RAISE EXCEPTION 'Library revision must exactly capture its current head.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER shared_library_history_guard BEFORE INSERT OR UPDATE OR DELETE ON "SharedStepGroupRevision" FOR EACH ROW EXECUTE FUNCTION vaettir_shared_library_history_guard();
CREATE FUNCTION vaettir_shared_library_revision_capture() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE context JSONB;
BEGIN
 IF (OLD.name,OLD.description,OLD.steps,OLD."archivedAt",OLD.revision) IS NOT DISTINCT FROM (NEW.name,NEW.description,NEW.steps,NEW."archivedAt",NEW.revision) THEN RETURN NEW; END IF;
 context := current_setting('vaettir.shared_step_write',true)::jsonb;
 INSERT INTO "SharedStepGroupRevision"(id,"groupId",revision,kind,snapshot,"actorId","actorName","requestId","requestHash",reason,"sourceRevision")
 VALUES('shared_revision_'||NEW.id||'_'||NEW.revision,NEW.id,NEW.revision,context->>'kind',
 jsonb_build_object('name',NEW.name,'description',NEW.description,'steps',NEW.steps,'archived',NEW."archivedAt" IS NOT NULL),
 context->>'actorId',context->>'actorName',context->>'requestId',context->>'requestHash',context->>'reason',(context->>'sourceRevision')::INTEGER);
 RETURN NEW;
END; $$;
CREATE TRIGGER shared_library_revision_capture AFTER UPDATE ON "SharedStepGroup" FOR EACH ROW EXECUTE FUNCTION vaettir_shared_library_revision_capture();

CREATE FUNCTION vaettir_shared_library_case_link_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE group_project TEXT; archived TIMESTAMP(3);
BEGIN
 IF NEW."sharedStepGroupId" IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (OLD."sharedStepGroupId",OLD."projectId") IS NOT DISTINCT FROM (NEW."sharedStepGroupId",NEW."projectId") THEN RETURN NEW; END IF;
 SELECT "projectId","archivedAt" INTO group_project,archived FROM "SharedStepGroup" WHERE id=NEW."sharedStepGroupId" FOR SHARE;
 IF archived IS NOT NULL THEN RAISE EXCEPTION 'Archived libraries cannot receive new case links.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER shared_library_case_link_guard BEFORE INSERT OR UPDATE OF "sharedStepGroupId","projectId" ON "TestCase" FOR EACH ROW EXECUTE FUNCTION vaettir_shared_library_case_link_guard();
