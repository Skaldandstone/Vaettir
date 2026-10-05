-- Additive, append-only collaboration. No existing cases or permissions change.
CREATE TABLE "CaseComment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaseComment_body_length" CHECK (char_length("body") BETWEEN 1 AND 4000 AND octet_length("body") <= 16000),
  CONSTRAINT "CaseComment_caseId_projectId_fkey" FOREIGN KEY ("caseId", "projectId") REFERENCES "TestCase"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CaseComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CaseComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CaseComment_projectId_caseId_authorId_requestId_key" ON "CaseComment"("projectId", "caseId", "authorId", "requestId");
CREATE INDEX "CaseComment_projectId_caseId_createdAt_id_idx" ON "CaseComment"("projectId", "caseId", "createdAt", "id");
CREATE INDEX "CaseComment_authorId_idx" ON "CaseComment"("authorId");
CREATE INDEX "CaseComment_organizationId_idx" ON "CaseComment"("organizationId");
-- Reparenting a project must not transfer old tenant text to its new owner or
-- let deletion of the new owner's case cascade through another tenant's text.
CREATE FUNCTION "guard_case_comment_original_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CaseComment" c JOIN "Project" p ON p.id=OLD."projectId"
    WHERE c."projectId"=OLD."projectId" AND c."caseId"=OLD.id AND c."organizationId"<>p."organizationId"
  ) THEN
    RAISE EXCEPTION 'Original-organization comments require reconciliation before deleting this case' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "TestCase_comment_original_scope_delete" BEFORE DELETE ON "TestCase"
FOR EACH ROW EXECUTE FUNCTION "guard_case_comment_original_scope"();
-- The parent still exists in this BEFORE trigger. A cascaded child trigger
-- cannot rely on joining a parent Project that has already been deleted.
CREATE FUNCTION "guard_project_comment_original_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CaseComment" c
    WHERE c."projectId"=OLD.id AND c."organizationId"<>OLD."organizationId"
  ) THEN
    RAISE EXCEPTION 'Original-organization comments require reconciliation before deleting this project' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "Project_comment_original_scope_delete" BEFORE DELETE ON "Project"
FOR EACH ROW EXECUTE FUNCTION "guard_project_comment_original_scope"();
