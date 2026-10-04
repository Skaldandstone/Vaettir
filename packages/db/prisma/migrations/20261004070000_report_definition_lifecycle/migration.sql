-- Additive source-only migration. Not applied tonight. Existing definitions stay
-- private/active and existing retry receipts explicitly lack historical bodies.
ALTER TABLE "ProjectReportDefinition"
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "ProjectReportDefinition" ADD CONSTRAINT "ProjectReportDefinition_visibility_check"
  CHECK ("visibility" IN ('private', 'project'));
ALTER TABLE "ProjectReportDefinitionWrite"
  ADD COLUMN "beforeState" JSONB,
  ADD COLUMN "afterState" JSONB;
CREATE INDEX "report_definition_scope_visibility_idx"
  ON "ProjectReportDefinition" ("projectId", "organizationId", "visibility", "archivedAt");
CREATE INDEX "report_definition_write_history_idx"
  ON "ProjectReportDefinitionWrite" ("definitionId", "projectId", "organizationId", "createdAt");
