ALTER TABLE "TestCaseSource" ADD COLUMN "importSnapshot" JSONB;

-- Imported identities are namespaced by provider and project. CI-sourced
-- external ids are intentionally not globally unique, so only rows with an
-- import baseline participate in this durable retry guard.
CREATE UNIQUE INDEX "TestCaseSource_importedExternalTestId_key"
    ON "TestCaseSource"("externalTestId")
    WHERE "importSnapshot" IS NOT NULL AND "externalTestId" IS NOT NULL;
