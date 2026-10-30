-- New writes only. Legacy keys, aliases, receipts and allocated case numbers remain unchanged.
CREATE OR REPLACE FUNCTION vaettir_project_case_key() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_key TEXT; suffix INTEGER; counter INTEGER; digit INTEGER; request_id TEXT; write_row "ProjectCaseKeyWrite"%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Project identity cannot be changed or rebound to retained key history' USING ERRCODE='23514';
    END IF;
    IF NEW."nextCaseNumber" < OLD."nextCaseNumber" THEN
      RAISE EXCEPTION 'Allocated case numbers cannot be reused' USING ERRCODE='23514';
    END IF;
    IF NEW."caseKey" IS NOT DISTINCT FROM OLD."caseKey" THEN
      IF NEW."caseKeyRevision" IS DISTINCT FROM OLD."caseKeyRevision" THEN
        RAISE EXCEPTION 'Case key revisions require a reviewed key change' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."caseKey" !~ '^[a-z]{3,5}$' THEN
      RAISE EXCEPTION 'Use 3-5 letters only for a new project key' USING ERRCODE='23514';
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
  IF EXISTS(SELECT 1 FROM "ProjectCaseKeyAlias" WHERE "projectId"=NEW.id)
    OR EXISTS(SELECT 1 FROM "ProjectCaseKeyWrite" WHERE "projectId"=NEW.id) THEN
    RAISE EXCEPTION 'Project identity has retained original key history and cannot be reused' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('vaettir-case-key:'||NEW."organizationId"));
  IF NEW."caseKey"='' THEN
    base_key:=left(regexp_replace(lower(NEW.slug),'[^a-z]','','g'),5);
    IF base_key='' THEN base_key:='prj'; END IF;
    base_key:=rpad(base_key,greatest(3,length(base_key)),'x');
    NEW."caseKey":=base_key; suffix:=0;
    WHILE EXISTS(SELECT 1 FROM "ProjectCaseKeyAlias" WHERE "organizationId"=NEW."organizationId" AND "caseKey"=NEW."caseKey") LOOP
      IF suffix>=10000 THEN
        RAISE EXCEPTION 'Choose an unused 3-5 letter project key' USING ERRCODE='23505';
      END IF;
      counter:=suffix; NEW."caseKey":='';
      FOR digit IN 1..5 LOOP
        NEW."caseKey":=chr(97+(counter%26))||NEW."caseKey"; counter:=counter/26;
      END LOOP;
      suffix:=suffix+1;
    END LOOP;
  END IF;
  IF NEW."caseKey" !~ '^[a-z]{3,5}$' THEN
    RAISE EXCEPTION 'Use 3-5 letters only for a new project key' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM "ProjectCaseKeyAlias" WHERE "organizationId"=NEW."organizationId" AND "caseKey"=NEW."caseKey") THEN
    RAISE EXCEPTION 'Project key is already reserved in this workspace' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
