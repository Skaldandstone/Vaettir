-- CreateTable
CREATE TABLE "AiDisclosurePolicy" (
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDisclosurePolicy_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "AiDisclosureGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvedClerkSubject" TEXT NOT NULL,
    "recipient" TEXT NOT NULL DEFAULT 'codex',
    "scope" TEXT NOT NULL DEFAULT 'aggregate_counts',
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "classificationVersion" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "tokenHash" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "readWindowStartedAt" TIMESTAMP(3),
    "readWindowCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiDisclosureGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDisclosureAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "grantId" TEXT,
    "actorId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "classificationVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDisclosureAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDisclosureCommand" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDisclosureCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiDisclosurePolicy_projectId_organizationId_key" ON "AiDisclosurePolicy"("projectId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiDisclosureGrant_tokenHash_key" ON "AiDisclosureGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "AiDisclosureGrant_organizationId_projectId_createdAt_idx" ON "AiDisclosureGrant"("organizationId", "projectId", "createdAt");
CREATE INDEX "AiDisclosureGrant_approvedByUserId_organizationId_idx" ON "AiDisclosureGrant"("approvedByUserId", "organizationId");

-- CreateIndex
CREATE INDEX "AiDisclosureAudit_organizationId_projectId_createdAt_idx" ON "AiDisclosureAudit"("organizationId", "projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiDisclosurePolicy" ADD CONSTRAINT "AiDisclosurePolicy_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDisclosurePolicy" ADD CONSTRAINT "AiDisclosurePolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDisclosurePolicy" ADD CONSTRAINT "AiDisclosurePolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDisclosureGrant" ADD CONSTRAINT "AiDisclosureGrant_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "AiDisclosurePolicy"("projectId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDisclosureGrant" ADD CONSTRAINT "AiDisclosureGrant_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDisclosureAudit" ADD CONSTRAINT "AiDisclosureAudit_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "AiDisclosurePolicy"("projectId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDisclosureCommand" ADD CONSTRAINT "AiDisclosureCommand_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "AiDisclosurePolicy"("projectId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restrict the database as well as the application to this preview's envelope.
ALTER TABLE "AiDisclosurePolicy" ADD CONSTRAINT "ai_policy_classification_check"
  CHECK (classification IN ('UNCLASSIFIED','SYNTHETIC','CUSTOMER_PROPRIETARY','REGULATED') AND version > 0);
ALTER TABLE "AiDisclosureGrant" ADD CONSTRAINT "ai_grant_scope_check"
  CHECK (recipient='codex' AND scope='aggregate_counts' AND role='VIEWER'
    AND "policyVersion"=1 AND "classificationVersion">0 AND version>0
    AND "tokenHash" ~ '^[a-f0-9]{64}$' AND "keyHint" ~ '^vai_[a-f0-9]{8}$'
    AND "readWindowCount">=0 AND "expiresAt">"createdAt");
ALTER TABLE "AiDisclosureAudit" ADD CONSTRAINT "ai_audit_envelope_check"
  CHECK (event IN ('CLASSIFICATION_UPDATED','GRANT_ISSUED','GRANT_ROTATED','GRANT_REVOKED','ALLOW','DENY','SUPPRESS')
    AND reason IN ('CUSTOMER_ADMIN_ACTION','APPROVED','POLICY_DENIED','SMALL_COHORT','INVALID_COUNTS')
    AND "policyVersion"=1 AND "classificationVersion">0);
ALTER TABLE "AiDisclosureCommand" ADD CONSTRAINT "ai_command_receipt_check"
  CHECK (id ~ '^[a-f0-9]{64}$' AND "requestHash" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(receipt)='object'
    AND receipt - ARRAY['operation','policyVersion','grantId','grantVersion'] = '{}'::jsonb);

-- Application reads/commands cannot rewrite a disclosure history or replace an
-- operation receipt after issuing a credential. Deletion/retention is a separate
-- reviewed migration; ordinary project deletion is deliberately restricted.
CREATE FUNCTION "rejectAiDisclosureHistoryMutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI disclosure history is append-only';
END;
$$;
CREATE TRIGGER "AiDisclosureAudit_append_only" BEFORE UPDATE OR DELETE ON "AiDisclosureAudit"
  FOR EACH ROW EXECUTE FUNCTION "rejectAiDisclosureHistoryMutation"();
CREATE TRIGGER "AiDisclosureCommand_append_only" BEFORE UPDATE OR DELETE ON "AiDisclosureCommand"
  FOR EACH ROW EXECUTE FUNCTION "rejectAiDisclosureHistoryMutation"();

-- Make authorization withdrawal durable even if an administrator is later
-- reinstated. All existing member/identity/suspension write paths receive the
-- same protection, including ones outside the AI integration router.
CREATE FUNCTION "revokeAiDisclosureGrants"(org_id text, actor_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE affected "AiDisclosureGrant"%ROWTYPE;
BEGIN
  FOR affected IN UPDATE "AiDisclosureGrant" SET "revokedAt"=CURRENT_TIMESTAMP,
    enabled=false, version=version+1
    WHERE "organizationId"=org_id AND (actor_id IS NULL OR "approvedByUserId"=actor_id)
      AND "revokedAt" IS NULL
    RETURNING *
  LOOP
    INSERT INTO "AiDisclosureAudit" (id,"organizationId","projectId","grantId","actorId",event,reason,"policyVersion","classificationVersion")
    VALUES (gen_random_uuid()::text, affected."organizationId",affected."projectId",affected.id,
      affected."approvedByUserId",'GRANT_REVOKED','AUTHORIZATION_WITHDRAWN',1,affected."classificationVersion");
  END LOOP;
END;
$$;
ALTER TABLE "AiDisclosureAudit" DROP CONSTRAINT "ai_audit_envelope_check";
ALTER TABLE "AiDisclosureAudit" ADD CONSTRAINT "ai_audit_envelope_check"
  CHECK (event IN ('CLASSIFICATION_UPDATED','GRANT_ISSUED','GRANT_ROTATED','GRANT_REVOKED','ALLOW','DENY','SUPPRESS')
    AND reason IN ('CUSTOMER_ADMIN_ACTION','AUTHORIZATION_WITHDRAWN','APPROVED','POLICY_DENIED','SMALL_COHORT','INVALID_COUNTS')
    AND "policyVersion"=1 AND "classificationVersion">0);
CREATE FUNCTION "revokeAiDisclosureOnMembershipChange"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM "revokeAiDisclosureGrants"(OLD."organizationId",OLD."userId");
    RETURN OLD;
  END IF;
  IF NEW.role NOT IN ('OWNER','ADMIN') OR NEW."seatType"<>'FULL' OR NEW."organizationId"<>OLD."organizationId" OR NEW."userId"<>OLD."userId" THEN
    PERFORM "revokeAiDisclosureGrants"(OLD."organizationId",OLD."userId");
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AiDisclosure_membership_withdrawal" AFTER UPDATE OR DELETE ON "Membership"
  FOR EACH ROW EXECUTE FUNCTION "revokeAiDisclosureOnMembershipChange"();
CREATE FUNCTION "revokeAiDisclosureOnIdentityChange"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id text;
BEGIN
  IF NEW."clerkUserId" IS DISTINCT FROM OLD."clerkUserId" THEN
    FOR org_id IN SELECT DISTINCT "organizationId" FROM "AiDisclosureGrant" WHERE "approvedByUserId"=OLD.id AND "revokedAt" IS NULL LOOP
      PERFORM "revokeAiDisclosureGrants"(org_id,OLD.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AiDisclosure_identity_withdrawal" AFTER UPDATE OF "clerkUserId" ON "User"
  FOR EACH ROW EXECUTE FUNCTION "revokeAiDisclosureOnIdentityChange"();
CREATE FUNCTION "revokeAiDisclosureOnSuspension"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."suspendedAt" IS NOT NULL THEN PERFORM "revokeAiDisclosureGrants"(NEW.id,NULL); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AiDisclosure_suspension_withdrawal" AFTER UPDATE OF "suspendedAt" ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION "revokeAiDisclosureOnSuspension"();
