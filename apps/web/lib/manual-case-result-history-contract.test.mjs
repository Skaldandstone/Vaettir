// SOURCE ONLY, NOT RUN. Static assertions are not database or rendered acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui = readFileSync(new URL("../components/ManualCaseResultHistory.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../api/src/services/manualCaseResults.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../packages/db/prisma/migrations/20261004080000_manual_case_result_history/migration.sql", import.meta.url), "utf8");
const erasure = readFileSync(new URL("../../api/src/services/manualCaseResultErasure.ts", import.meta.url), "utf8");
test("original scope and deterministic current native CAS precede private result replacement", () => {
  for (const literal of ["lockManualRetestAccess", "run.projectId !== input.projectId", "input.expectedCurrentFingerprint", "state.head?.currentRevisionId", "manualStepResultHead.count", "size.count > 1"]) assert.ok(service.includes(literal), literal);
  const record = service.slice(service.indexOf("export async function recordManualCaseResult"));
  assert.ok(record.indexOf("accessRun") < record.indexOf("const receipt ="));
  assert.ok(record.indexOf("return acknowledgement(receipt, true)") < record.indexOf("const [historySize]"));
  assert.ok(record.includes("historySize.count >= 10000")); assert.ok(record.includes("16n * 1024n * 1024n"));
  assert.ok(record.includes("const [incomingSize]"));
  assert.ok(record.includes("JSON.stringify(input.observations)}::jsonb::text"));
  assert.ok(record.includes("const payloadBytes = Number(incomingSize.bytes)"));
});
test("immutable prior payload and unknown legacy recorder/time are not fabricated earlier revisions", () => {
  for (const literal of ["UNVERSIONED_OBSERVATION_CAPTURED_NOW", "originalRecorder: null", "originalRecordedAt: null", "observations: state.result.observations", "previousRevisionId: state.head?.currentRevisionId ?? null", "input.correctionReason"]) assert.ok(service.includes(literal), literal);
  assert.ok(!service.includes("recomputeFlaky")); assert.ok(!service.includes("resolveHealingSuggestionsOnPass"));
});
test("database final projection and whole-org erasure guard have no session bypass/backfill", () => {
  for (const literal of ["DEFERRABLE INITIALLY DEFERRED", "manual_case_projection_required", "manual_case_revision_immutable", "manual_case_head_progression", "manual_case_cumulative_bound", "manual_case_tenant_erasure_only", 'WHERE id=OLD."organizationId"', 'WHERE id=OLD."testResultId"']) assert.ok(migration.includes(literal), literal);
  assert.ok(!migration.includes("current_setting")); assert.ok(!migration.includes("set_config"));
  assert.ok(!migration.includes('UPDATE "TestResult"')); assert.ok(!migration.includes('INSERT INTO "ManualCaseResultRevision"'));
  assert.ok(erasure.indexOf("preview.blocked") < erasure.indexOf("manualCaseResultHead.deleteMany"));
  assert.ok(erasure.includes("counts.heads > 100000 || counts.revisions > 100000"));
  assert.ok(migration.includes('"correctionReason"))+2048>NEW."payloadBytes"'));
  assert.ok(migration.includes('BEFORE INSERT OR UPDATE ON "ManualStepResultHead"'));
  assert.ok(migration.includes("manual_step_case_mode_conflict"));
  assert.ok(erasure.includes("number = 100; number >= 1; number--"));
});
test("native origin and fresh actual query guards withhold old private caches but retain exact draft/UUID", () => {
  for (const literal of ["const [nativeOrigin]", "nativeSame", "!project.error && !project.isFetching && !project.isPaused", "!organizations.error && !organizations.isFetching && !organizations.isPaused", "!history.error && !history.isFetching && !history.isPaused", "manualCaseReadMatches", "const input", "attempt ?? buildRequest()", "if (known && !unknown.current)"]) assert.ok(ui.includes(literal), literal);
  assert.ok(ui.indexOf(": history.error ?") < ui.indexOf(": !ready ?"));
  assert.ok(ui.includes("Private cached observations are hidden"));
  assert.ok(!ui.includes("if (!available) setAttempt(null)"));
});
test("reviewed correction ACK stays separate from refresh failure and unknown request cannot be edited away", () => {
  assert.ok(ui.includes("manualCaseAckMatches(input, draft.baseline.revisionNumber + 1"));
  assert.ok(ui.indexOf("setReceipt(value)") < ui.indexOf("void Promise.all"));
  assert.ok(ui.includes("The revision is confirmed, but refreshing the native view failed"));
  assert.ok(ui.includes("if (!available || !editor || !draft || !definitive || unknown.current"));
  assert.ok(ui.includes("Earlier results remain evidence"));
});
