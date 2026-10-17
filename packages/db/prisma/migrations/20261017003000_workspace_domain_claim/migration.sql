-- Additive: existing organizations are neither renamed nor assigned a hostname.
CREATE TABLE "WorkspaceDomain" (
  "name" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT UNIQUE,
  "claimedByUserId" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceDomain_label_check" CHECK (
    "name" ~ '^[a-z][a-z0-9-]{1,61}[a-z0-9]$'
    AND position('--' in "name") = 0
    AND "name" NOT IN (
      'www','app','api','auth','login','logout','sign-in','sign-up',
      'admin','administrator','support','help','status','mail','email',
      'smtp','imap','pop','ftp','cdn','assets','static','media','files',
      'billing','payments','checkout','account','accounts','onboarding',
      'docs','developer','developers','dev','test','staging','preview',
      'demo','sandbox','internal','localhost','security','abuse','legal',
      'privacy','terms','vaettir','skaldandstone-admin','autodiscover'
    )
  ),
  CONSTRAINT "WorkspaceDomain_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE RESTRICT
);
-- Keep a minimal tombstone on erasure; a retired hostname must never be recycled.
CREATE FUNCTION workspace_domain_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workspace addresses cannot be released or recycled';
  END IF;
  IF NEW."name" IS DISTINCT FROM OLD."name"
     OR NEW."claimedAt" IS DISTINCT FROM OLD."claimedAt"
     OR NEW."claimedByUserId" IS DISTINCT FROM OLD."claimedByUserId"
     OR (NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
         AND NOT (NEW."organizationId" IS NULL AND OLD."organizationId" IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM "Organization" WHERE id=OLD."organizationId")))
  THEN RAISE EXCEPTION 'A confirmed workspace address is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_domain_immutable BEFORE UPDATE OR DELETE ON "WorkspaceDomain"
  FOR EACH ROW EXECUTE FUNCTION workspace_domain_immutable();
