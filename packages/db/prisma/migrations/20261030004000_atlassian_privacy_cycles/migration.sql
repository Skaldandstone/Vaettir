-- Coordinate the provider's cycle per app/account, across project connections.
ALTER TABLE "AtlassianOAuthConnection" ADD COLUMN "privacyCycleDays" DOUBLE PRECISION, ADD COLUMN "privacyAccountKey" TEXT, ADD COLUMN "privacyClaimId" TEXT;
CREATE INDEX "AtlassianOAuthConnection_privacyAccountKey_idx" ON "AtlassianOAuthConnection"("privacyAccountKey");
