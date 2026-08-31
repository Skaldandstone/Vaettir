-- Preserve every existing source mapping. Identical CI names in separate
-- projects are valid; the API serializes writes and rejects local ambiguity.
DROP INDEX "TestCaseSource_externalTestId_key";
CREATE INDEX "TestCaseSource_externalTestId_idx" ON "TestCaseSource"("externalTestId");
-- Rollback warning: recreating global uniqueness can fail after duplicate CI
-- names are admitted across projects. Old globally scoped code is unsafe.
