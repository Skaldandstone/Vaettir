CREATE TABLE "ProjectQualityRiskState" (
  "projectId" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "nextNumber" INTEGER NOT NULL DEFAULT 0 CHECK ("nextNumber" BETWEEN 0 AND 1000),
  CONSTRAINT "ProjectQualityRiskState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectQualityRiskState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "QualityRiskEntry" (
  id TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 1000),
  "displayId" TEXT NOT NULL, title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  definition JSONB NOT NULL CHECK (octet_length(definition::text)<=18000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 1000000),
  "createdById" TEXT NOT NULL, "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QualityRiskEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectQualityRiskState"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QualityRiskEntry_projectId_number_key" ON "QualityRiskEntry"("projectId",number);
CREATE UNIQUE INDEX "QualityRiskEntry_projectId_displayId_key" ON "QualityRiskEntry"("projectId","displayId");
CREATE TABLE "QualityRiskDecision" (
  id TEXT PRIMARY KEY, "entryId" TEXT NOT NULL, "assessedVersion" INTEGER NOT NULL,
  "createdVersion" INTEGER NOT NULL CHECK ("createdVersion"="assessedVersion"+1),
  decision JSONB NOT NULL CHECK (octet_length(decision::text)<=9000),
  baseline JSONB NOT NULL CHECK (octet_length(baseline::text)<=18000),
  evidence JSONB NOT NULL CHECK (octet_length(evidence::text)<=16000),
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityRiskDecision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "QualityRiskEntry"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QualityRiskDecision_entryId_createdVersion_key" ON "QualityRiskDecision"("entryId","createdVersion");
CREATE TABLE "QualityRiskWrite" (
  id TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL CHECK (length("requestHash")=64),
  receipt JSONB NOT NULL CHECK (octet_length(receipt::text)<=2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityRiskWrite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectQualityRiskState"("projectId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QualityRiskWrite_projectId_actorId_requestId_key" ON "QualityRiskWrite"("projectId","actorId","requestId");

-- Recorded human decisions and exact write acknowledgements are append-only.
-- Only the existing explicit organization-erasure workflow can delete them.
CREATE FUNCTION vaettir_quality_risk_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_org TEXT;
BEGIN
  IF TG_TABLE_NAME='QualityRiskDecision' THEN
    SELECT s."organizationId" INTO original_org FROM "QualityRiskEntry" e JOIN "ProjectQualityRiskState" s ON s."projectId"=e."projectId" WHERE e.id=OLD."entryId";
  ELSE
    SELECT "organizationId" INTO original_org FROM "ProjectQualityRiskState" WHERE "projectId"=OLD."projectId";
  END IF;
  IF TG_OP='DELETE' AND original_org IS NOT NULL AND current_setting('vaettir.quality_risk_erasure',true)=original_org THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Quality risk decisions and receipts are immutable';
END $$;
CREATE TRIGGER "QualityRiskDecision_immutable" BEFORE UPDATE OR DELETE ON "QualityRiskDecision" FOR EACH ROW EXECUTE FUNCTION vaettir_quality_risk_immutable();
CREATE TRIGGER "QualityRiskWrite_immutable" BEFORE UPDATE OR DELETE ON "QualityRiskWrite" FOR EACH ROW EXECUTE FUNCTION vaettir_quality_risk_immutable();

CREATE FUNCTION vaettir_quality_risk_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='ProjectQualityRiskState' THEN
    IF NEW."projectId" IS DISTINCT FROM OLD."projectId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR NEW."nextNumber" < OLD."nextNumber" THEN RAISE EXCEPTION 'Quality risk tenant and counter identity are immutable'; END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."projectId" IS DISTINCT FROM OLD."projectId" OR NEW.number IS DISTINCT FROM OLD.number
      OR NEW."displayId" IS DISTINCT FROM OLD."displayId" OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW.version <> OLD.version+1
      THEN RAISE EXCEPTION 'Quality risk identity is immutable and each change requires the next version'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProjectQualityRiskState_identity" BEFORE UPDATE ON "ProjectQualityRiskState" FOR EACH ROW EXECUTE FUNCTION vaettir_quality_risk_identity();
CREATE TRIGGER "QualityRiskEntry_identity" BEFORE UPDATE ON "QualityRiskEntry" FOR EACH ROW EXECUTE FUNCTION vaettir_quality_risk_identity();
