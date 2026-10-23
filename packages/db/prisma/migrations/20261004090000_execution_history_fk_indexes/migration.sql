-- Ordered after 20261004080000_manual_case_result_history, which owns the table.
-- Additive lookup/FK indexes only. All rows, relationships, history and
-- authorization constraints remain unchanged. No customer data is modified.
-- These ordinary indexes acquire write locks while building: release planning
-- must review table sizes and a maintenance window before applying production.
CREATE INDEX "TestRun_projectId_idx" ON "TestRun"("projectId");
CREATE INDEX "ManualCaseResultRevision_testResultId_idx" ON "ManualCaseResultRevision"("testResultId");
CREATE INDEX "ComplianceEvidence_testResultId_idx" ON "ComplianceEvidence"("testResultId");
