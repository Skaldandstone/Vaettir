import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source contracts only. Actual PostgreSQL transition-table, lock-wait,
// isolation, rollback and large-population performance acceptance is separate.
const migration = readFileSync(
  new URL("../packages/db/prisma/migrations/20261004100000_manual_step_delete_set_guard/migration.sql", import.meta.url),
  "utf8",
);
const sql = migration.replace(/--[^\r\n]*/g, "").trim();
const fn = sql.slice(sql.indexOf("CREATE FUNCTION"), sql.indexOf("$$;"));
const lock = fn.indexOf("PERFORM r.id");
const lockEnd = fn.indexOf("FOR UPDATE OF r;");
const isolation = fn.indexOf("IF current_setting('transaction_isolation')");
const head = fn.indexOf('JOIN "ManualStepResultHead" h');

test("coverage replacement is atomic and DELETE is one AFTER transition-table statement guard", () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;$/);
  assert.match(sql, /CREATE TRIGGER manual_step_result_delete_set_guard\s+AFTER DELETE ON "TestResult"\s+REFERENCING OLD TABLE AS vaettir_deleted_results\s+FOR EACH STATEMENT EXECUTE FUNCTION vaettir_manual_step_result_delete_set_guard\(\);/);
  assert.equal((sql.match(/CREATE(?: OR REPLACE)? TRIGGER/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /DROP\s|DISABLE\s+TRIGGER|SET\s+CONSTRAINTS|session_replication_role/i);
});

test("existing INSERT and UPDATE checks keep the original row function unchanged", () => {
  assert.match(sql, /CREATE OR REPLACE TRIGGER manual_step_result_write_guard\s+BEFORE INSERT OR UPDATE ON "TestResult"\s+FOR EACH ROW EXECUTE FUNCTION vaettir_manual_step_result_write_guard\(\);/);
  assert.equal((sql.match(/CREATE FUNCTION/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /CREATE(?: OR REPLACE)? FUNCTION vaettir_manual_step_result_write_guard/);
  assert.doesNotMatch(sql, /vaettir_manual_step_run_finalize_guard|manual_step_run_finalize_guard/);
});

test("distinct deterministic run locks finish before a separate VOLATILE head query", () => {
  assert.match(fn, /RETURNS TRIGGER LANGUAGE plpgsql VOLATILE/);
  assert.match(fn, /PERFORM r.id\s+FROM "TestRun" r\s+WHERE r.id IN \(\s+SELECT DISTINCT deleted\."testRunId" FROM vaettir_deleted_results deleted\s+\)\s+ORDER BY r.id\s+FOR UPDATE OF r;/);
  assert.ok(lock >= 0 && lockEnd > lock && isolation > lockEnd && head > isolation);
  assert.doesNotMatch(fn.slice(lock, lockEnd), /ManualStepResultHead/);
  assert.match(fn.slice(head), /h\."testRunId" = deleted\."testRunId"\s+AND h\."testCaseId" = deleted\."testCaseId"/);
  assert.match(fn.slice(head), /WHERE r\."ciProvider" = 'manual'/);
});

test("snapshot-isolated nonempty manual deletes fail closed without rejecting zero or CI-only transitions", () => {
  assert.match(fn, /IF current_setting\('transaction_isolation'\) <> 'read committed' AND EXISTS \(\s+SELECT 1\s+FROM vaettir_deleted_results deleted\s+JOIN "TestRun" r ON r.id = deleted\."testRunId"\s+WHERE r\."ciProvider" = 'manual'\s+\) THEN/);
  assert.match(fn, /ERRCODE = '40001', CONSTRAINT = 'manual_step_delete_isolation_required'/);
  assert.equal((fn.match(/current_setting\(/g) ?? []).length, 1);
  assert.doesNotMatch(fn, /set_config\(|SET\s+LOCAL|vaettir\.manual_step_projection/i);
});

test("any protected head rejects the whole statement with the existing constraint and no skip/bypass", () => {
  const protectedQuery = fn.slice(fn.lastIndexOf("IF EXISTS"));
  assert.match(protectedQuery, /JOIN "ManualStepResultHead" h/);
  assert.match(protectedQuery, /ERRCODE = '23514', CONSTRAINT = 'manual_step_projection_required'/);
  assert.match(protectedQuery, /END IF;\s+RETURN NULL;/);
  assert.doesNotMatch(fn, /EXCEPTION\s+WHEN|RETURN OLD|RETURN NEW|\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:FROM|INTO|ONLY|"Test)/i);
  assert.equal((fn.match(/RAISE EXCEPTION/g) ?? []).length, 2);
});
