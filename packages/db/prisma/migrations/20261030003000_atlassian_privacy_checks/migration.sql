-- Nullable additions preserve the existing OAuth model/client and all grants.
ALTER TABLE "AtlassianOAuthConnection" ADD COLUMN "privacyCheckedAt" TIMESTAMP(3), ADD COLUMN "privacyDueAt" TIMESTAMP(3);
CREATE INDEX "AtlassianOAuthConnection_privacyDueAt_idx" ON "AtlassianOAuthConnection"("privacyDueAt");
