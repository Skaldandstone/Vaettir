-- No connection or user is enabled. Existing observations cannot imply grants.
ALTER TABLE "IdentityDirectoryConnection" ADD COLUMN "mappings" JSONB NOT NULL DEFAULT '[]';
