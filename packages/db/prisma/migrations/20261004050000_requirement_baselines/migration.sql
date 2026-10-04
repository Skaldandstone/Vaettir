CREATE TABLE "ProjectRequirementBaselineState" (
  "projectId" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 0 CHECK ("nextNumber" BETWEEN 0 AND 10000),
  CONSTRAINT "ProjectRequirementBaselineState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectRequirementBaselineState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CaseTraceabilityLink_requirement_scope_idx" ON "CaseTraceabilityLink"("projectId","requirementId","removedAt");
CREATE TABLE "RequirementBaseline" (
  id TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "requirementId" TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 10000), "displayId" TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 100),
  snapshot JSONB NOT NULL CHECK (octet_length(snapshot::text)<=48000),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint)=64), rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 1 AND 600),
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequirementBaseline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectRequirementBaselineState"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RequirementBaseline_projectId_number_key" ON "RequirementBaseline"("projectId",number);
CREATE UNIQUE INDEX "RequirementBaseline_projectId_displayId_key" ON "RequirementBaseline"("projectId","displayId");
CREATE UNIQUE INDEX "RequirementBaseline_projectId_requirementId_version_key" ON "RequirementBaseline"("projectId","requirementId",version);
CREATE TABLE "RequirementBaselineWrite" (
  id TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL CHECK (length("requestHash")=64),
  receipt JSONB NOT NULL CHECK (octet_length(receipt::text)<=2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequirementBaselineWrite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectRequirementBaselineState"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RequirementBaselineWrite_projectId_actorId_requestId_key" ON "RequirementBaselineWrite"("projectId","actorId","requestId");
CREATE FUNCTION vaettir_requirement_baseline_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_org TEXT;
BEGIN
  SELECT "organizationId" INTO original_org FROM "ProjectRequirementBaselineState" WHERE "projectId"=OLD."projectId";
  IF TG_TABLE_NAME='ProjectRequirementBaselineState' AND TG_OP='UPDATE' THEN
    IF NEW."projectId" IS DISTINCT FROM OLD."projectId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."nextNumber"<OLD."nextNumber"
      THEN RAISE EXCEPTION 'Requirement baseline original tenant and counter are immutable'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND original_org IS NOT NULL AND current_setting('vaettir.requirement_baseline_erasure',true)=original_org THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Requirement baselines and write acknowledgements are immutable';
END $$;
CREATE TRIGGER "ProjectRequirementBaselineState_immutable" BEFORE UPDATE OR DELETE ON "ProjectRequirementBaselineState" FOR EACH ROW EXECUTE FUNCTION vaettir_requirement_baseline_immutable();
CREATE TRIGGER "RequirementBaseline_immutable" BEFORE UPDATE OR DELETE ON "RequirementBaseline" FOR EACH ROW EXECUTE FUNCTION vaettir_requirement_baseline_immutable();
CREATE TRIGGER "RequirementBaselineWrite_immutable" BEFORE UPDATE OR DELETE ON "RequirementBaselineWrite" FOR EACH ROW EXECUTE FUNCTION vaettir_requirement_baseline_immutable();
