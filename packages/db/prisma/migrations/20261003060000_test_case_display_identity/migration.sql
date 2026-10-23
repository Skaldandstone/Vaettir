-- Add stable project-local case numbers without replacing any internal IDs,
-- imported external IDs, content, history, prerequisites or human edits.
-- Old Prisma clients may omit the new fields; triggers allocate for them too.
BEGIN;
LOCK TABLE "Project", "TestCase" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE "Project" ADD COLUMN "caseKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "nextCaseNumber" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TestCase" ADD COLUMN "caseNumber" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "displayId" TEXT NOT NULL DEFAULT '';

-- Deterministic first assignment for existing projects and cases. This only
-- assigns previously absent identities, never changes a previously issued ID.
DO $$
DECLARE project_row RECORD; base_key TEXT; chosen_key TEXT; suffix INTEGER;
BEGIN
  FOR project_row IN SELECT id, slug, "organizationId" FROM "Project" ORDER BY "createdAt", id LOOP
    base_key := left(regexp_replace(lower(project_row.slug), '[^a-z0-9]', '', 'g'), 20);
    IF base_key = '' THEN base_key := 'project'; END IF;
    IF base_key !~ '^[a-z]' THEN base_key := 'p' || base_key; END IF;
    chosen_key := base_key; suffix := 1;
    WHILE EXISTS (SELECT 1 FROM "Project" WHERE "organizationId" = project_row."organizationId" AND "caseKey" = chosen_key) LOOP
      suffix := suffix + 1;
      chosen_key := left(base_key, 16) || '-' || suffix::text;
    END LOOP;
    UPDATE "Project" SET "caseKey" = chosen_key WHERE id = project_row.id;
  END LOOP;
END $$;
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY "projectId" ORDER BY "createdAt", id)::integer AS number
  FROM "TestCase"
)
UPDATE "TestCase" AS tc SET "caseNumber" = numbered.number,
  "displayId" = project."caseKey" || '-' || lpad(numbered.number::text, greatest(2, length(numbered.number::text)), '0')
FROM numbered, "Project" AS project
WHERE tc.id = numbered.id AND project.id = tc."projectId";
UPDATE "Project" SET "nextCaseNumber" = coalesce((SELECT max("caseNumber") FROM "TestCase" WHERE "projectId" = "Project".id), 0);

CREATE UNIQUE INDEX "Project_organizationId_caseKey_key" ON "Project"("organizationId", "caseKey");
CREATE UNIQUE INDEX "TestCase_projectId_caseNumber_key" ON "TestCase"("projectId", "caseNumber");
CREATE UNIQUE INDEX "TestCase_projectId_displayId_key" ON "TestCase"("projectId", "displayId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_caseKey_format" CHECK ("caseKey" ~ '^[a-z][a-z0-9-]{0,23}$'),
  ADD CONSTRAINT "Project_nextCaseNumber_nonnegative" CHECK ("nextCaseNumber" >= 0);
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_caseNumber_positive" CHECK ("caseNumber" > 0),
  ADD CONSTRAINT "TestCase_displayId_format" CHECK ("displayId" ~ '^[a-z][a-z0-9-]{0,23}-[0-9]{2,}$');

CREATE FUNCTION vaettir_project_case_key() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_key TEXT; suffix INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."nextCaseNumber" < OLD."nextCaseNumber" THEN
      RAISE EXCEPTION 'Allocated case numbers cannot be reused' USING ERRCODE = '23514';
    END IF;
    IF NEW."caseKey" IS DISTINCT FROM OLD."caseKey" AND OLD."nextCaseNumber" > 0 THEN
      RAISE EXCEPTION 'Project key is fixed after the first case identity is assigned' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."nextCaseNumber" <> 0 THEN
    RAISE EXCEPTION 'Case counters are assigned by the database' USING ERRCODE = '23514';
  END IF;
  IF NEW."caseKey" = '' THEN
    -- Serialize default-key collision resolution per organization. A hash
    -- collision over-serializes unrelated organizations; it never mixes data.
    PERFORM pg_advisory_xact_lock(hashtext('vaettir-case-key:' || NEW."organizationId"));
    base_key := left(regexp_replace(lower(NEW.slug), '[^a-z0-9]', '', 'g'), 20);
    IF base_key = '' THEN base_key := 'project'; END IF;
    IF base_key !~ '^[a-z]' THEN base_key := 'p' || base_key; END IF;
    NEW."caseKey" := base_key; suffix := 1;
    WHILE EXISTS (SELECT 1 FROM "Project" WHERE "organizationId" = NEW."organizationId" AND "caseKey" = NEW."caseKey") LOOP
      suffix := suffix + 1;
      NEW."caseKey" := left(base_key, 16) || '-' || suffix::text;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Project_case_identity_key" BEFORE INSERT OR UPDATE ON "Project"
  FOR EACH ROW EXECUTE FUNCTION vaettir_project_case_key();

CREATE FUNCTION vaettir_allocate_case_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocated_number INTEGER; project_key TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."projectId" IS DISTINCT FROM OLD."projectId" OR NEW."caseNumber" IS DISTINCT FROM OLD."caseNumber" OR NEW."displayId" IS DISTINCT FROM OLD."displayId" THEN
      RAISE EXCEPTION 'Test case identity cannot be changed or moved to another project' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."caseNumber" <> 0 OR NEW."displayId" <> '' THEN
    RAISE EXCEPTION 'Test case identities are assigned by the database' USING ERRCODE = '23514';
  END IF;
  -- Atomic row update serializes all creation/import paths for this project.
  -- A rolled-back creation rolls back its allocation; committed deletions do
  -- not reduce the counter and their numbers are never reused.
  UPDATE "Project" SET "nextCaseNumber" = "nextCaseNumber" + 1
    WHERE id = NEW."projectId" RETURNING "nextCaseNumber", "caseKey" INTO allocated_number, project_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found' USING ERRCODE = '23503'; END IF;
  NEW."caseNumber" := allocated_number;
  NEW."displayId" := project_key || '-' || lpad(allocated_number::text, greatest(2, length(allocated_number::text)), '0');
  RETURN NEW;
END $$;
CREATE TRIGGER "TestCase_allocate_display_identity" BEFORE INSERT OR UPDATE ON "TestCase"
  FOR EACH ROW EXECUTE FUNCTION vaettir_allocate_case_identity();
COMMIT;
