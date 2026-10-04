-- SOURCE-ONLY ADDITIVE DRAFT. NOT EXECUTED/VALIDATED.
-- No backfill of unversioned observations and no session-selector bypass.
CREATE TABLE "ManualCaseResultRevision" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"projectId" TEXT NOT NULL,
 "testRunId" TEXT NOT NULL,"testCaseId" TEXT NOT NULL,"testResultId" TEXT NOT NULL,
 "revisionNumber" INTEGER NOT NULL CHECK ("revisionNumber" BETWEEN 1 AND 100),
 "status" "TestResultStatus" NOT NULL CHECK (status::text IN ('PASS','FAIL','BLOCKED','SKIP')),
 "note" TEXT,"observations" JSONB NOT NULL DEFAULT '{}',"legacyPrior" JSONB,
 "correctionReason" TEXT,"actorId" TEXT NOT NULL,"actorClerkUserId" TEXT NOT NULL,"actorLabel" TEXT NOT NULL,
 "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"previousRevisionId" TEXT,
 "idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"payloadBytes" INTEGER NOT NULL CHECK ("payloadBytes" BETWEEN 0 AND 262144),
 CONSTRAINT "ManualCaseResultRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultRevision_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultRevision_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultRevision_testResultId_fkey" FOREIGN KEY ("testResultId") REFERENCES "TestResult"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultRevision_previousRevisionId_fkey" FOREIGN KEY ("previousRevisionId") REFERENCES "ManualCaseResultRevision"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManualCaseResultRevision_previousRevisionId_key" ON "ManualCaseResultRevision"("previousRevisionId");
CREATE UNIQUE INDEX "ManualCaseResultRevision_scope_revision_key" ON "ManualCaseResultRevision"("testRunId","testCaseId","revisionNumber");
CREATE UNIQUE INDEX "ManualCaseResultRevision_actor_uuid_key" ON "ManualCaseResultRevision"("organizationId","actorId","idempotencyKey");
CREATE INDEX "ManualCaseResultRevision_organizationId_projectId_idx" ON "ManualCaseResultRevision"("organizationId","projectId");
CREATE INDEX "ManualCaseResultRevision_scope_revision_idx" ON "ManualCaseResultRevision"("testRunId","testCaseId","revisionNumber");
CREATE TABLE "ManualCaseResultHead" (
 "organizationId" TEXT NOT NULL,"projectId" TEXT NOT NULL,"testRunId" TEXT NOT NULL,"testCaseId" TEXT NOT NULL,
 "testResultId" TEXT NOT NULL,"currentRevisionId" TEXT NOT NULL,"revisionCount" INTEGER NOT NULL CHECK ("revisionCount" BETWEEN 1 AND 100),
 "currentPayloadBytes" INTEGER NOT NULL CHECK ("currentPayloadBytes" BETWEEN 0 AND 262144),
 PRIMARY KEY ("testRunId","testCaseId"),
 CONSTRAINT "ManualCaseResultHead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultHead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultHead_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultHead_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultHead_testResultId_fkey" FOREIGN KEY ("testResultId") REFERENCES "TestResult"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManualCaseResultHead_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "ManualCaseResultRevision"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManualCaseResultHead_testResultId_key" ON "ManualCaseResultHead"("testResultId");
CREATE UNIQUE INDEX "ManualCaseResultHead_currentRevisionId_key" ON "ManualCaseResultHead"("currentRevisionId");
CREATE INDEX "ManualCaseResultHead_organizationId_projectId_idx" ON "ManualCaseResultHead"("organizationId","projectId");

CREATE FUNCTION vaettir_assert_manual_case_tuple(org_id TEXT, project_id TEXT, run_id TEXT, case_id TEXT, result_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE provider TEXT; run_project TEXT; planned BOOLEAN;
BEGIN
 SELECT "ciProvider","projectId",case_id=ANY("manualTestCaseIds") INTO provider,run_project,planned FROM "TestRun" WHERE id=run_id FOR UPDATE;
 IF provider IS DISTINCT FROM 'manual' OR run_project IS DISTINCT FROM project_id OR planned IS DISTINCT FROM true OR
   NOT EXISTS(SELECT 1 FROM "Project" WHERE id=project_id AND "organizationId"=org_id) OR
   NOT EXISTS(SELECT 1 FROM "TestCase" WHERE id=case_id AND "projectId"=project_id) OR
   NOT EXISTS(SELECT 1 FROM "TestResult" WHERE id=result_id AND "testRunId"=run_id AND "testCaseId"=case_id) OR
   (SELECT count(*) FROM "TestResult" WHERE "testRunId"=run_id AND "testCaseId"=case_id)<>1 OR
   EXISTS(SELECT 1 FROM "ManualStepResultHead" WHERE "testRunId"=run_id AND "testCaseId"=case_id) THEN
  RAISE EXCEPTION 'Whole-case history requires one original-organization native manual result, not CI or step-derived evidence.' USING ERRCODE='23514',CONSTRAINT='manual_case_original_tuple';
 END IF;
END; $$;

CREATE FUNCTION vaettir_manual_case_revision_insert_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE h "ManualCaseResultHead"; native "TestResult"; run_status TEXT; persisted_bytes BIGINT; persisted_count INTEGER;
BEGIN
 PERFORM vaettir_assert_manual_case_tuple(NEW."organizationId",NEW."projectId",NEW."testRunId",NEW."testCaseId",NEW."testResultId");
 SELECT count(*)::int,coalesce(sum(octet_length(concat(note,observations::text,"legacyPrior"::text,"actorLabel","correctionReason"))+2048),0)::bigint
  INTO persisted_count,persisted_bytes FROM "ManualCaseResultRevision" WHERE "testRunId"=NEW."testRunId";
 IF persisted_count>=10000 OR persisted_bytes+NEW."payloadBytes">16777216 THEN
  RAISE EXCEPTION 'This run reached its cumulative immutable history bound; prior receipts remain recoverable.' USING ERRCODE='23514',CONSTRAINT='manual_case_cumulative_bound';
 END IF;
 SELECT status::text INTO run_status FROM "TestRun" WHERE id=NEW."testRunId";
 IF run_status IS DISTINCT FROM 'RUNNING' OR NOT EXISTS(
   SELECT 1 FROM "User" u JOIN "Membership" m ON m."userId"=u.id JOIN "Organization" o ON o.id=m."organizationId"
   WHERE u.id=NEW."actorId" AND u."clerkUserId"=NEW."actorClerkUserId" AND o.id=NEW."organizationId" AND o."suspendedAt" IS NULL
    AND m."seatType"::text='FULL' AND m.role::text IN ('OWNER','ADMIN','EDITOR')) THEN
  RAISE EXCEPTION 'A current full human editor and active native manual run are required.' USING ERRCODE='23514',CONSTRAINT='manual_case_current_actor';
 END IF;
 SELECT * INTO h FROM "ManualCaseResultHead" WHERE "testRunId"=NEW."testRunId" AND "testCaseId"=NEW."testCaseId";
 IF FOUND THEN
  IF (NEW."organizationId",NEW."projectId",NEW."testResultId",NEW."previousRevisionId",NEW."revisionNumber") IS DISTINCT FROM
    (h."organizationId",h."projectId",h."testResultId",h."currentRevisionId",h."revisionCount"+1) OR NEW."legacyPrior" IS NOT NULL OR length(trim(coalesce(NEW."correctionReason",'')))=0 THEN
   RAISE EXCEPTION 'A correction must extend the exact immutable tip with a human reason.' USING ERRCODE='23514',CONSTRAINT='manual_case_revision_tip';
  END IF;
 ELSE
  IF NEW."revisionNumber"<>1 OR NEW."previousRevisionId" IS NOT NULL THEN
   RAISE EXCEPTION 'First whole-case history starts at revision one, without an invented prior revision.' USING ERRCODE='23514',CONSTRAINT='manual_case_first_revision';
  END IF;
  IF NEW."legacyPrior" IS NOT NULL THEN
   SELECT * INTO native FROM "TestResult" WHERE id=NEW."testResultId";
   IF NEW."legacyPrior" IS DISTINCT FROM jsonb_build_object('basis','UNVERSIONED_OBSERVATION_CAPTURED_NOW','originalRecorder',NULL,'originalRecordedAt',NULL,
      'captured',jsonb_build_object('resultId',native.id,'status',native.status::text,'note',native.note,'observations',native.observations)) OR length(trim(coalesce(NEW."correctionReason",'')))=0 THEN
    RAISE EXCEPTION 'Legacy evidence must be captured exactly now with unknown original author/time and a human reason.' USING ERRCODE='23514',CONSTRAINT='manual_case_legacy_capture';
   END IF;
  END IF;
 END IF;
 IF octet_length(concat(NEW.note,NEW.observations::text,NEW."legacyPrior"::text,NEW."actorLabel",NEW."correctionReason"))+2048>NEW."payloadBytes" OR length(NEW."actorLabel") NOT BETWEEN 1 AND 200 OR
   NEW."requestHash"!~'^[a-f0-9]{64}$' OR length(coalesce(NEW.note,''))>10000 OR length(coalesce(NEW."correctionReason",''))>2000 THEN
  RAISE EXCEPTION 'Whole-case observation metadata exceeds its declared bounded payload.' USING ERRCODE='23514',CONSTRAINT='manual_case_payload_bounds';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER manual_case_revision_insert_guard BEFORE INSERT ON "ManualCaseResultRevision" FOR EACH ROW EXECUTE FUNCTION vaettir_manual_case_revision_insert_guard();
CREATE FUNCTION vaettir_manual_case_revision_update_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Recorded whole-case revisions are immutable; write a new reviewed revision.' USING ERRCODE='23514',CONSTRAINT='manual_case_revision_immutable';
END; $$;
CREATE TRIGGER manual_case_revision_update_guard BEFORE UPDATE ON "ManualCaseResultRevision" FOR EACH ROW EXECUTE FUNCTION vaettir_manual_case_revision_update_guard();

CREATE FUNCTION vaettir_manual_case_head_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r "ManualCaseResultRevision";
BEGIN
 PERFORM vaettir_assert_manual_case_tuple(NEW."organizationId",NEW."projectId",NEW."testRunId",NEW."testCaseId",NEW."testResultId");
 SELECT * INTO r FROM "ManualCaseResultRevision" WHERE id=NEW."currentRevisionId";
 IF NOT FOUND OR (r."organizationId",r."projectId",r."testRunId",r."testCaseId",r."testResultId",r."revisionNumber",r."payloadBytes") IS DISTINCT FROM
  (NEW."organizationId",NEW."projectId",NEW."testRunId",NEW."testCaseId",NEW."testResultId",NEW."revisionCount",NEW."currentPayloadBytes") THEN
  RAISE EXCEPTION 'The whole-case head must name one exact stored revision and native result tuple.' USING ERRCODE='23514',CONSTRAINT='manual_case_head_tuple';
 END IF;
 IF TG_OP='INSERT' THEN
  IF r."revisionNumber"<>1 OR r."previousRevisionId" IS NOT NULL THEN RAISE EXCEPTION 'First head must point to the first revision.' USING ERRCODE='23514',CONSTRAINT='manual_case_first_head'; END IF;
 ELSE
  IF (NEW."organizationId",NEW."projectId",NEW."testRunId",NEW."testCaseId",NEW."testResultId") IS DISTINCT FROM
    (OLD."organizationId",OLD."projectId",OLD."testRunId",OLD."testCaseId",OLD."testResultId") OR
    (NEW."currentRevisionId" IS DISTINCT FROM OLD."currentRevisionId" AND (r."previousRevisionId" IS DISTINCT FROM OLD."currentRevisionId" OR NEW."revisionCount"<>OLD."revisionCount"+1)) OR
    (NEW."currentRevisionId"=OLD."currentRevisionId" AND (NEW."revisionCount",NEW."currentPayloadBytes") IS DISTINCT FROM (OLD."revisionCount",OLD."currentPayloadBytes")) THEN
   RAISE EXCEPTION 'The head identity is fixed and may only advance one immutable tip.' USING ERRCODE='23514',CONSTRAINT='manual_case_head_progression';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER manual_case_head_guard BEFORE INSERT OR UPDATE ON "ManualCaseResultHead" FOR EACH ROW EXECUTE FUNCTION vaettir_manual_case_head_guard();

CREATE FUNCTION vaettir_manual_case_result_projection_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE h "ManualCaseResultHead"; r "ManualCaseResultRevision";
BEGIN
 -- Run lock serializes legacy first-write and first-head activation; no selector can bypass.
 PERFORM id FROM "TestRun" WHERE id=NEW."testRunId" FOR UPDATE;
 IF TG_OP='UPDATE' AND (OLD.id,OLD."testRunId",OLD."testCaseId") IS DISTINCT FROM (NEW.id,NEW."testRunId",NEW."testCaseId") AND
  EXISTS(SELECT 1 FROM "ManualCaseResultHead" WHERE "testResultId"=OLD.id) THEN
  RAISE EXCEPTION 'Tracked native result identity cannot be moved.' USING ERRCODE='23514',CONSTRAINT='manual_case_projection_identity';
 END IF;
 SELECT * INTO h FROM "ManualCaseResultHead" WHERE "testRunId"=NEW."testRunId" AND "testCaseId"=NEW."testCaseId";
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN RAISE EXCEPTION 'A tracked case already has its single native result.' USING ERRCODE='23514',CONSTRAINT='manual_case_projection_duplicate'; END IF;
 PERFORM vaettir_assert_manual_case_tuple(h."organizationId",h."projectId",h."testRunId",h."testCaseId",h."testResultId");
 SELECT * INTO r FROM "ManualCaseResultRevision" WHERE id=h."currentRevisionId";
 IF h."testResultId" IS DISTINCT FROM NEW.id OR (NEW.status,NEW.note,NEW.observations) IS DISTINCT FROM (r.status,r.note,r.observations) OR
   (to_jsonb(NEW)-ARRAY['status','note','observations']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','note','observations']) THEN
  RAISE EXCEPTION 'Use the exact reviewed whole-case revision; legacy writes cannot overwrite tracked observations.' USING ERRCODE='23514',CONSTRAINT='manual_case_projection_required';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER manual_case_result_projection_guard BEFORE INSERT OR UPDATE ON "TestResult" FOR EACH ROW EXECUTE FUNCTION vaettir_manual_case_result_projection_guard();

-- Reverse direction also needs a guard: an incomplete step head need not update
-- TestResult at all. Existing step immutable/receipt guards remain untouched.
CREATE FUNCTION vaettir_manual_step_case_mode_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM "TestRun" WHERE id=NEW."testRunId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "ManualCaseResultHead" WHERE "testRunId"=NEW."testRunId" AND "testCaseId"=NEW."testCaseId") THEN
  RAISE EXCEPTION 'Step observations cannot coexist with tracked whole-case observations for this exact native run/case.' USING ERRCODE='23514',CONSTRAINT='manual_step_case_mode_conflict';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER manual_step_case_mode_guard BEFORE INSERT OR UPDATE ON "ManualStepResultHead" FOR EACH ROW EXECUTE FUNCTION vaettir_manual_step_case_mode_guard();

CREATE FUNCTION vaettir_manual_case_final_consistency() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE h "ManualCaseResultHead"; r "ManualCaseResultRevision"; native "TestResult"; run_id TEXT; case_id TEXT;
BEGIN
 IF TG_OP='DELETE' THEN run_id:=OLD."testRunId"; case_id:=OLD."testCaseId";
 ELSE run_id:=NEW."testRunId"; case_id:=NEW."testCaseId"; END IF;
 SELECT * INTO h FROM "ManualCaseResultHead" WHERE "testRunId"=run_id AND "testCaseId"=case_id;
 -- Explicit original-tenant erasure may remove all heads/revisions before native rows.
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM "ManualCaseResultRevision" WHERE "testRunId"=run_id AND "testCaseId"=case_id) THEN RAISE EXCEPTION 'A retained revision cannot commit without its tracked head.' USING ERRCODE='23514',CONSTRAINT='manual_case_final_head'; END IF;
  IF TG_OP='DELETE' AND (EXISTS(SELECT 1 FROM "Organization" WHERE id=OLD."organizationId") OR EXISTS(SELECT 1 FROM "TestResult" WHERE id=OLD."testResultId")) THEN
   RAISE EXCEPTION 'Retained whole-case history may only be removed with its exact original organization and native result during authorized tenant erasure.' USING ERRCODE='23514',CONSTRAINT='manual_case_tenant_erasure_only';
  END IF;
  RETURN NULL;
 END IF;
 PERFORM vaettir_assert_manual_case_tuple(h."organizationId",h."projectId",run_id,case_id,h."testResultId");
 SELECT * INTO r FROM "ManualCaseResultRevision" WHERE id=h."currentRevisionId";
 SELECT * INTO native FROM "TestResult" WHERE id=h."testResultId";
 IF r.id IS NULL OR native.id IS NULL OR (r."organizationId",r."projectId",r."testRunId",r."testCaseId",r."testResultId",r."revisionNumber",r."payloadBytes") IS DISTINCT FROM
   (h."organizationId",h."projectId",run_id,case_id,h."testResultId",h."revisionCount",h."currentPayloadBytes") OR (native.status,native.note,native.observations) IS DISTINCT FROM (r.status,r.note,r.observations) OR
   (SELECT count(*) FROM "ManualCaseResultRevision" WHERE "testRunId"=run_id AND "testCaseId"=case_id AND "organizationId"=h."organizationId" AND "projectId"=h."projectId")<>h."revisionCount" THEN
  RAISE EXCEPTION 'Final native projection and immutable whole-case history must agree.' USING ERRCODE='23514',CONSTRAINT='manual_case_final_projection';
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER manual_case_head_final_consistency AFTER INSERT OR UPDATE OR DELETE ON "ManualCaseResultHead" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vaettir_manual_case_final_consistency();
CREATE CONSTRAINT TRIGGER manual_case_revision_final_consistency AFTER INSERT OR DELETE ON "ManualCaseResultRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vaettir_manual_case_final_consistency();
CREATE CONSTRAINT TRIGGER manual_case_projection_final_consistency AFTER INSERT OR UPDATE ON "TestResult" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vaettir_manual_case_final_consistency();
-- Restrictive native FKs preserve history on ordinary deletions. Authorized tenant
-- erasure must delete scoped heads then revision tips before native TestResults.
-- No blanket DELETE trigger, source processing, inferred old author/time or backfill.
