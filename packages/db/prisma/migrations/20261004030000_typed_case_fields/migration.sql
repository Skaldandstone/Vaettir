-- Additive: no existing customer values are invented, removed or overwritten.
ALTER TABLE "Project" ADD COLUMN "caseFieldSchema" JSONB NOT NULL DEFAULT '{"version":1,"fields":[]}', ADD COLUMN "caseFieldSchemaVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TestCase" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "caseFieldSchemaVersion" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION vaettir_case_field_value_problem(field JSONB, value JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF (field->>'retired')::boolean THEN RETURN false; END IF;
  IF value IS NULL OR value='null'::jsonb OR (jsonb_typeof(value)='string' AND (value#>>'{}') ~ '^[[:space:]]*$') THEN RETURN (field->>'required')::boolean; END IF;
  CASE field->>'type'
    WHEN 'TEXT' THEN RETURN jsonb_typeof(value) <> 'string' OR length(value#>>'{}')>2000;
    WHEN 'NUMBER' THEN RETURN jsonb_typeof(value) <> 'number' OR abs((value#>>'{}')::numeric)>1000000000000;
    WHEN 'BOOLEAN' THEN RETURN jsonb_typeof(value) <> 'boolean';
    WHEN 'CHOICE' THEN RETURN jsonb_typeof(value) <> 'string' OR NOT (field->'options' @> jsonb_build_array(value));
    WHEN 'DATE' THEN
      IF jsonb_typeof(value) <> 'string' OR (value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN true; END IF;
      BEGIN RETURN to_char((value#>>'{}')::date,'YYYY-MM-DD') <> (value#>>'{}'); EXCEPTION WHEN others THEN RETURN true; END;
    ELSE RETURN true;
  END CASE;
END $$;

CREATE FUNCTION vaettir_case_field_schema_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE field JSONB; previous JSONB; key TEXT;
BEGIN
  IF jsonb_typeof(NEW."caseFieldSchema") IS DISTINCT FROM 'object' OR NEW."caseFieldSchema"->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(NEW."caseFieldSchema"->'fields') IS DISTINCT FROM 'array' OR octet_length(NEW."caseFieldSchema"::text)>32768 OR jsonb_array_length(NEW."caseFieldSchema"->'fields')>20 THEN RAISE EXCEPTION 'Unsupported case field schema'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(NEW."caseFieldSchema"))<>2 OR (SELECT count(*) FROM jsonb_array_elements(NEW."caseFieldSchema"->'fields')) <> (SELECT count(DISTINCT f->>'key') FROM jsonb_array_elements(NEW."caseFieldSchema"->'fields') f) THEN RAISE EXCEPTION 'Unsupported case field schema keys'; END IF;
  FOR field IN SELECT * FROM jsonb_array_elements(NEW."caseFieldSchema"->'fields') LOOP
    IF jsonb_typeof(field) IS DISTINCT FROM 'object' OR NOT (field ?& ARRAY['key','label','type','required','retired','options']) THEN RAISE EXCEPTION 'Incomplete case field definition'; END IF;
    key:=field->>'key';
    IF jsonb_typeof(field->'key') IS DISTINCT FROM 'string' OR key IS NULL OR key !~ '^[a-z][a-z0-9_]{0,39}$' OR key IN ('constructor','prototype','__proto__') OR jsonb_typeof(field->'label') IS DISTINCT FROM 'string' OR length(btrim(field->>'label')) NOT BETWEEN 1 AND 120 OR jsonb_typeof(field->'type') IS DISTINCT FROM 'string' OR field->>'type' NOT IN ('TEXT','NUMBER','BOOLEAN','DATE','CHOICE') OR jsonb_typeof(field->'required') IS DISTINCT FROM 'boolean' OR jsonb_typeof(field->'retired') IS DISTINCT FROM 'boolean' OR jsonb_typeof(field->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(field->'options')>30 OR (SELECT count(*) FROM jsonb_object_keys(field))<>6 THEN RAISE EXCEPTION 'Invalid case field definition'; END IF;
    IF ((field->>'type'='CHOICE') AND jsonb_array_length(field->'options')=0) OR ((field->>'type'<>'CHOICE') AND jsonb_array_length(field->'options')<>0) OR ((field->>'retired')::boolean AND (field->>'required')::boolean) OR EXISTS(SELECT 1 FROM jsonb_array_elements(field->'options') option WHERE jsonb_typeof(option)<>'string' OR length(option#>>'{}') NOT BETWEEN 1 AND 120 OR (option#>>'{}') ~ '^[[:space:]]*$') OR (SELECT count(*) FROM jsonb_array_elements(field->'options'))<>(SELECT count(DISTINCT option) FROM jsonb_array_elements(field->'options') option) THEN RAISE EXCEPTION 'Invalid case field choices'; END IF;
    IF TG_OP='UPDATE' THEN
      SELECT f INTO previous FROM jsonb_array_elements(OLD."caseFieldSchema"->'fields') f WHERE f->>'key'=key;
      -- Every saved definition is immutable in meaning, including after values
      -- have been cleared. Historical evidence cannot be silently reinterpreted.
      IF previous IS NOT NULL AND (previous->>'type' IS DISTINCT FROM field->>'type' OR previous->'options' IS DISTINCT FROM field->'options') THEN RAISE EXCEPTION 'Saved case field types and choices are immutable'; END IF;
    END IF;
  END LOOP;
  IF TG_OP='UPDATE' THEN
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(OLD."caseFieldSchema"->'fields') prior WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."caseFieldSchema"->'fields') now WHERE now->>'key'=prior->>'key')) THEN RAISE EXCEPTION 'Retire case fields instead of deleting definitions'; END IF;
    IF NEW."caseFieldSchema" IS DISTINCT FROM OLD."caseFieldSchema" THEN NEW."caseFieldSchemaVersion":=OLD."caseFieldSchemaVersion"+1;
    ELSE NEW."caseFieldSchemaVersion":=OLD."caseFieldSchemaVersion"; END IF;
  ELSE NEW."caseFieldSchemaVersion":=0; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vaettir_case_field_schema_guard BEFORE INSERT OR UPDATE OF "caseFieldSchema", "caseFieldSchemaVersion" ON "Project" FOR EACH ROW EXECUTE FUNCTION vaettir_case_field_schema_guard();

CREATE FUNCTION vaettir_case_field_values_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE schema JSONB; revision INTEGER; field JSONB; key TEXT;
BEGIN
  -- Serializes definitions against every explicit case author/value write.
  SELECT p."caseFieldSchema",p."caseFieldSchemaVersion" INTO schema,revision FROM "Project" p WHERE p.id=NEW."projectId" FOR SHARE;
  IF schema IS NULL THEN RAISE EXCEPTION 'Case field project is unavailable'; END IF;
  IF jsonb_typeof(NEW."customFields")<>'object' OR octet_length(NEW."customFields"::text)>65536 OR (SELECT count(*) FROM jsonb_object_keys(NEW."customFields"))>100 THEN RAISE EXCEPTION 'Unsupported custom case metadata'; END IF;
  FOR key IN SELECT jsonb_object_keys(NEW."customFields") LOOP
    IF key !~ '^[a-z][a-z0-9_]{0,39}$' OR key IN ('constructor','prototype','__proto__') OR jsonb_typeof(NEW."customFields"->key) NOT IN ('string','number','boolean','null') THEN RAISE EXCEPTION 'Unsupported custom case value'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(schema->'fields') f WHERE f->>'key'=key AND NOT (f->>'retired')::boolean) THEN
      IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Unknown or retired metadata cannot be newly introduced'; END IF;
      IF OLD."customFields"->key IS DISTINCT FROM NEW."customFields"->key THEN RAISE EXCEPTION 'Unknown or retired metadata must remain intact'; END IF;
    END IF;
  END LOOP;
  IF TG_OP='UPDATE' THEN
    FOR key IN SELECT jsonb_object_keys(OLD."customFields") LOOP
      IF NOT (NEW."customFields" ? key) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(schema->'fields') f WHERE f->>'key'=key AND NOT (f->>'retired')::boolean) THEN RAISE EXCEPTION 'Retained case metadata cannot be removed'; END IF;
    END LOOP;
  END IF;
  FOR field IN SELECT * FROM jsonb_array_elements(schema->'fields') LOOP
    IF vaettir_case_field_value_problem(field,NEW."customFields"->(field->>'key')) THEN RAISE EXCEPTION 'Required or typed case field % needs review',field->>'label'; END IF;
  END LOOP;
  NEW."caseFieldSchemaVersion":=revision;
  RETURN NEW;
END $$;
CREATE TRIGGER vaettir_case_field_values_insert BEFORE INSERT ON "TestCase" FOR EACH ROW EXECUTE FUNCTION vaettir_case_field_values_guard();
CREATE TRIGGER vaettir_case_field_values_edit BEFORE UPDATE OF "customFields",title,background,given,"when","then",tags,"testType","validationDomain","verificationProfile","sharedStepGroupId" ON "TestCase" FOR EACH ROW
WHEN (OLD."customFields" IS DISTINCT FROM NEW."customFields" OR OLD.title IS DISTINCT FROM NEW.title OR OLD.background IS DISTINCT FROM NEW.background OR OLD.given IS DISTINCT FROM NEW.given OR OLD."when" IS DISTINCT FROM NEW."when" OR OLD."then" IS DISTINCT FROM NEW."then" OR OLD.tags IS DISTINCT FROM NEW.tags OR OLD."testType" IS DISTINCT FROM NEW."testType" OR OLD."validationDomain" IS DISTINCT FROM NEW."validationDomain" OR OLD."verificationProfile" IS DISTINCT FROM NEW."verificationProfile" OR OLD."sharedStepGroupId" IS DISTINCT FROM NEW."sharedStepGroupId") EXECUTE FUNCTION vaettir_case_field_values_guard();
