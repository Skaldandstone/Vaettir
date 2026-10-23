-- Additive mixed-version protection. A rollback image can read step runs but
-- cannot overwrite their derived verdicts or finalize without accounting for
-- partial step failures. These transaction-local selectors identify the current
-- application write path; they are NOT an actor authorization boundary.
CREATE FUNCTION vaettir_guard_manual_step_result(
  run_id TEXT, case_id TEXT, deleting BOOLEAN
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  provider TEXT;
  projection TEXT;
BEGIN
  -- Current and legacy application writers already use run-first locking. The
  -- database also serializes a result write with first-step activation.
  SELECT "ciProvider" INTO provider FROM "TestRun" WHERE id = run_id FOR UPDATE;
  IF provider = 'manual' AND EXISTS (
    SELECT 1 FROM "ManualStepResultHead"
    WHERE "testRunId" = run_id AND "testCaseId" = case_id
  ) THEN
    projection := NULLIF(current_setting('vaettir.manual_step_projection', true), '');
    IF deleting OR projection IS NULL OR
      projection::jsonb <> jsonb_build_array(run_id, case_id) THEN
      RAISE EXCEPTION 'This case is executed per step. Use a compatible API to record or correct its step outcomes.'
        USING ERRCODE = '23514', CONSTRAINT = 'manual_step_projection_required';
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION vaettir_manual_step_result_write_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM vaettir_guard_manual_step_result(OLD."testRunId", OLD."testCaseId", true);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND
    (OLD."testRunId", OLD."testCaseId") IS DISTINCT FROM
    (NEW."testRunId", NEW."testCaseId") THEN
    PERFORM vaettir_guard_manual_step_result(OLD."testRunId", OLD."testCaseId", false);
  END IF;
  PERFORM vaettir_guard_manual_step_result(NEW."testRunId", NEW."testCaseId", false);
  RETURN NEW;
END;
$$;

CREATE TRIGGER manual_step_result_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON "TestResult"
FOR EACH ROW EXECUTE FUNCTION vaettir_manual_step_result_write_guard();

CREATE FUNCTION vaettir_manual_step_run_finalize_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- The row is already locked by this UPDATE, in the same run-first order used
  -- by both application versions. No-op updates remain harmless.
  IF OLD."ciProvider" = 'manual' AND
    (OLD.status, OLD."finishedAt") IS DISTINCT FROM (NEW.status, NEW."finishedAt") AND
    EXISTS (SELECT 1 FROM "ManualStepResultHead" WHERE "testRunId" = OLD.id) AND
    current_setting('vaettir.manual_step_finalize', true) IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'This run has step outcomes. A compatible API must include partial step failures before finalizing it.'
      USING ERRCODE = '23514', CONSTRAINT = 'manual_step_finalize_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manual_step_run_finalize_guard
BEFORE UPDATE OF status, "finishedAt" ON "TestRun"
FOR EACH ROW EXECUTE FUNCTION vaettir_manual_step_run_finalize_guard();
