// SOURCE ONLY: authored NOT RUN. Disposable DB, mixed-version and real UI gates remain.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = path => readFileSync(new URL(path, import.meta.url), "utf8");
const legacy = source("../../api/src/routers/manualExecution.ts");
const erasure = source("../../api/src/services/orgHardDelete.ts");
const admin = source("../app/admin/organizations/[id]/page.tsx");
const steps = source("../../api/src/services/manualStepExecution.ts");
const page = source("../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx");
const ui = source("../components/ManualCaseResultHistory.tsx");
const central = source("../../api/src/router.ts");
const migration = source("../../../packages/db/prisma/migrations/20261004080000_manual_case_result_history/migration.sql");

test("deferred polymorphic native-result trigger only evaluates erasure-only OLD fields inside DELETE operation branch", () => {
  assert.doesNotMatch(migration, /IF TG_OP='DELETE' AND/);
  assert.match(migration, /IF TG_OP='DELETE' THEN\s+IF EXISTS\(SELECT 1 FROM "Organization" WHERE id=OLD\."organizationId"\)/);
});

test("step mode refuses tracked whole-case evidence after recovering original receipts but before procedure/body loads", () => {
  const record = steps.slice(steps.indexOf("export async function recordManualStepResult"));
  const recovered = record.indexOf("recovered: true");
  const guard = record.indexOf("await tx.manualCaseResultHead.count");
  const procedure = record.indexOf("const definition = frozenStructuredCase");
  assert.ok(recovered >= 0 && guard > recovered && procedure > guard);
  assert.match(record.slice(guard, procedure), /code: "CONFLICT"/);
});

test("legacy manual writes refuse tracked observations under the run lock before private body materialization", () => {
  const start = legacy.indexOf("recordResult:");
  assert.ok(start >= 0);
  const body = legacy.slice(start);
  const lock = body.indexOf('SELECT id FROM "TestRun"');
  const access = body.indexOf("await requireCurrentPlanAccess");
  const planned = body.indexOf("run.manualTestCaseIds.includes");
  const guard = body.indexOf("await tx.manualCaseResultHead.count");
  const privateRead = body.indexOf("const existing = await tx.testResult.findFirst");
  assert.ok(lock >= 0 && access > lock && planned > access && guard > planned && privateRead > guard);
  assert.match(body.slice(guard, privateRead), /code: "CONFLICT"/);
  assert.match(body.slice(guard, privateRead), /immutable whole-case observation history/);
});
test("exact original history metadata is previewed and unsupported scope refuses before all child deletions", () => {
  assert.match(erasure, /manualCaseResultScope: \{/);
  assert.match(erasure, /ManualCaseResultHead: manualCaseEvidence.ManualCaseResultHead/);
  assert.match(erasure, /ManualCaseResultRevision: manualCaseEvidence.ManualCaseResultRevision/);
  assert.match(erasure, /overBound: manualCaseEvidence.overBound/);
  const transaction = erasure.slice(erasure.indexOf("const rowCounts = await prisma.$transaction"));
  const lock = transaction.indexOf("await lockReportErasureScope");
  const check = transaction.indexOf("await previewManualCaseResultErasure");
  const refused = transaction.indexOf("if (manualCaseEvidence.blocked)");
  const firstChild = transaction.indexOf('await del("ProjectReportDefinitionWrite"');
  assert.ok(lock >= 0 && check > lock && refused > check && firstChild > refused);
});
test("history erasure is inside complete tenant transaction before native result FKs, without selector bypass", () => {
  const transaction = erasure.slice(erasure.indexOf("const rowCounts = await prisma.$transaction"));
  const history = transaction.indexOf("Object.assign(counts, await eraseManualCaseResultHistory(tx, organizationId))");
  const native = transaction.indexOf('await del("TestResult"');
  const org = transaction.indexOf("await tx.organization.delete");
  assert.ok(history >= 0 && native > history && org > native);
  assert.doesNotMatch(transaction, /set_config\('vaettir\.manual_case/);
});
test("destructive admin action refuses old, foreign or blocked whole-case preview rather than treating missing history as zero", () => {
  assert.match(admin, /manualCaseResultScope\?\.originalOrganizationId === organizationId/);
  assert.match(admin, /manualCaseResultScope.basis === "ORIGINAL_ORGANIZATION"/);
  assert.match(admin, /!!manualCaseErasureScope && !manualCaseErasureScope.blocked/);
  assert.match(admin, /Original history ownership is unavailable/);
  assert.match(admin, /Unsupported native tuples/);
  assert.match(admin, /Counts are not truncated/);
  assert.match(admin, /if \(!deletionReviewReady\)/);
});
test("native mounted history retains original case through collapse and blocks completion while responses remain unknown", () => {
  assert.match(central, /manualCaseResults: manualCaseResultsRouter/);
  assert.match(page, /ManualCaseResultHistory key=\{`\$\{projectId\}:\$\{testRunId\}:\$\{testCase.testCaseId\}`\}/);
  assert.match(page, /testCaseId=\{testCase.testCaseId\} active=\{readable && expanded && !stepMode\}/);
  assert.match(page, /unconfirmedWholeCases.size > 0 \|\|/);
  assert.match(page, /current.has\(tc.testCaseId\) === pending\) return current/);
  assert.match(page, /wholeCasePending \|\| !!testCase.currentResult/);
  assert.match(ui, /const editor = !disabled && readable/);
  assert.match(ui, /const ready = active && nativeSame/);
});
