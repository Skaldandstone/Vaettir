-- Preserve every existing source mapping. Identical CI names in separate
-- projects are valid; the API serializes writes and rejects local ambiguity.
-- Some production databases predate the checked-in baseline constraint even
-- though their Prisma migration history is otherwise current. Treat the
-- already-absent legacy index as the desired starting state.
DROP INDEX IF EXISTS "TestCaseSource_externalTestId_key";
-- A task can be stopped after PostgreSQL creates the index but before Prisma
-- records the migration as complete. Retrying that partial state is safe.
CREATE INDEX IF NOT EXISTS "TestCaseSource_externalTestId_idx" ON "TestCaseSource"("externalTestId");

-- Rollback warning: recreating global uniqueness can fail after duplicate CI
-- names are admitted across projects. Old globally scoped code is unsafe.
