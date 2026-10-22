-- No users, roles, memberships or grants are created. Extend the independent
-- whole-case INSERT guard to the same explicit runs.execute contribution.
-- Application code still verifies the transport subject and locks its policy
-- and source rows before writing; a session setting is never a grant bypass.
CREATE FUNCTION vaettir_identity_may_execute(org_id TEXT, project_id TEXT, user_id TEXT, clerk_subject TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM "IdentityAccessPolicy" p
  JOIN "Organization" o ON o.id=p."organizationId" AND o."suspendedAt" IS NULL
  JOIN "Project" project ON project.id=project_id AND project."organizationId"=o.id
  JOIN "Membership" m ON m."organizationId"=o.id AND m."userId"=user_id AND m."seatType"::text='FULL'
  JOIN "User" u ON u.id=m."userId" AND u."clerkUserId"=clerk_subject
  CROSS JOIN LATERAL jsonb_array_elements(p.configuration->'roles') role_rule(value)
  WHERE p."organizationId"=org_id AND p.configuration->>'schemaVersion'='1'
   AND m.role::text IN ('OWNER','ADMIN','EDITOR','VIEWER','COMPLIANCE_AUDITOR')
   AND NOT EXISTS (SELECT 1 FROM "ApiKey" k WHERE k."serviceUserId"=u.id)
   AND role_rule.value->'permissions' @> '["runs.execute"]'::jsonb AND (
    EXISTS (SELECT 1 FROM jsonb_array_elements(p.configuration->'groups') g
     WHERE g->'userIds' @> jsonb_build_array(user_id) AND g->'roleIds' @> jsonb_build_array(role_rule.value->>'id')
      AND (g#>>'{scope,kind}'='workspace' OR (g#>>'{scope,kind}'='projects' AND g#>'{scope,projectIds}' @> jsonb_build_array(project_id))))
    OR EXISTS (
     SELECT 1 FROM "IdentityDirectorySubject" s JOIN "IdentityDirectoryConnection" c
      ON c.id=s."connectionId" AND c."organizationId"=s."organizationId"
     CROSS JOIN LATERAL jsonb_array_elements(c.mappings) mapping
     WHERE s."organizationId"=org_id AND s."userId"=user_id AND s."clerkSubject"=clerk_subject
      AND s.enabled AND s.active AND c.enabled AND s."appliedGeneration">0
      AND s."observedConnectionRevision"=c.revision AND s."observedSubjectRevision"=s.revision
      AND s."observedAt"<=clock_timestamp() AT TIME ZONE 'UTC' AND s."expiresAt">clock_timestamp() AT TIME ZONE 'UTC'
      AND mapping->>'roleId'=role_rule.value->>'id' AND mapping->>'externalGroupId'=ANY(s."externalGroupIds")
      AND (mapping#>>'{scope,kind}'='workspace' OR (mapping#>>'{scope,kind}'='projects' AND mapping#>'{scope,projectIds}' @> jsonb_build_array(project_id)))
    )
   )
 );
$$;

-- Preserve tuple, immutable-tip, cumulative history, payload and legacy-capture
-- guards verbatim. Only the independently checked action alternative is new.
CREATE OR REPLACE FUNCTION vaettir_manual_case_revision_insert_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
    AND m."seatType"::text='FULL' AND (m.role::text IN ('OWNER','ADMIN','EDITOR') OR
      vaettir_identity_may_execute(NEW."organizationId",NEW."projectId",NEW."actorId",NEW."actorClerkUserId"))) THEN
  RAISE EXCEPTION 'Current full human execution permission and an active native manual run are required.' USING ERRCODE='23514',CONSTRAINT='manual_case_current_actor';
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
