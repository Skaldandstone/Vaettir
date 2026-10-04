-- Replace only the per-result DELETE check, not INSERT/UPDATE or finalization.
-- PostgreSQL 17 transition tables are available to AFTER statement triggers.
-- https://www.postgresql.org/docs/17/sql-createtrigger.html
-- https://www.postgresql.org/docs/17/trigger-datachanges.html
-- https://www.postgresql.org/docs/17/xfunc-volatility.html
-- https://www.postgresql.org/docs/17/transaction-iso.html
-- All DDL is atomic: no committed interval lacks the DELETE protection.
BEGIN;

CREATE FUNCTION vaettir_manual_step_result_delete_set_guard()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  -- One lock per distinct affected run, in deterministic order. Keep this SQL
  -- statement separate from the head read: at READ COMMITTED the latter must
  -- obtain a new snapshot AFTER any first-head writer's lock wait completes.
  PERFORM r.id
  FROM "TestRun" r
  WHERE r.id IN (
    SELECT DISTINCT deleted."testRunId" FROM vaettir_deleted_results deleted
  )
  ORDER BY r.id
  FOR UPDATE OF r;

  -- Merely locking a run does not create a newer row version. At REPEATABLE
  -- READ/SERIALIZABLE a head committed after the transaction snapshot can stay
  -- invisible even after that lock wait. Refuse manual deletions instead of
  -- pretending that VOLATILE alone fixes transaction-snapshot visibility.
  -- Zero-row and CI-only statements remain supported at these isolation levels.
  IF current_setting('transaction_isolation') <> 'read committed' AND EXISTS (
    SELECT 1
    FROM vaettir_deleted_results deleted
    JOIN "TestRun" r ON r.id = deleted."testRunId"
    WHERE r."ciProvider" = 'manual'
  ) THEN
    RAISE EXCEPTION 'Deleting manual result evidence requires READ COMMITTED isolation.'
      USING ERRCODE = '40001', CONSTRAINT = 'manual_step_delete_isolation_required';
  END IF;

  -- No transaction setting can authorize deleting a step-derived projection.
  -- A single protected member rejects the ENTIRE native DELETE statement.
  IF EXISTS (
    SELECT 1
    FROM vaettir_deleted_results deleted
    JOIN "TestRun" r ON r.id = deleted."testRunId"
    JOIN "ManualStepResultHead" h
      ON h."testRunId" = deleted."testRunId"
      AND h."testCaseId" = deleted."testCaseId"
    WHERE r."ciProvider" = 'manual'
  ) THEN
    RAISE EXCEPTION 'This case is executed per step. Use a compatible API to record or correct its step outcomes.'
      USING ERRCODE = '23514', CONSTRAINT = 'manual_step_projection_required';
  END IF;

  -- An AFTER statement trigger cannot skip or replace any native row.
  RETURN NULL;
END;
$$;

-- Reuse the unchanged original function for its original INSERT/UPDATE checks.
CREATE OR REPLACE TRIGGER manual_step_result_write_guard
BEFORE INSERT OR UPDATE ON "TestResult"
FOR EACH ROW EXECUTE FUNCTION vaettir_manual_step_result_write_guard();

CREATE TRIGGER manual_step_result_delete_set_guard
AFTER DELETE ON "TestResult"
REFERENCING OLD TABLE AS vaettir_deleted_results
FOR EACH STATEMENT EXECUTE FUNCTION vaettir_manual_step_result_delete_set_guard();

-- Normal application writers lock runs before result tuples. Direct SQL DELETE
-- has already locked result tuples before this AFTER trigger locks runs; an
-- opposite-order concurrent writer can cause PostgreSQL to abort a deadlock.
-- That abort is safe refusal, not a promised contention-free execution path.
COMMIT;
