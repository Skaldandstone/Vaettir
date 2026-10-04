// Source contracts authored NOT RUN; not migrated/authenticated/runtime proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const router = readFileSync(new URL("../../api/src/routers/manualExecution.ts", import.meta.url), "utf8");
const read = router.slice(router.indexOf("getForExecution: protectedProcedure"), router.indexOf("recordResult: protectedProcedure"));
test("bounded current actor/native scope locks precede private native execution body projection", () => {
  assert.ok(read.includes(".input(manualExecutionReadScopeInputSchema)"));
  assert.ok(read.includes("manualExecutionReadScopeOutputSchema.extend"));
  assert.ok(read.indexOf("await lockManualExecutionReadScope(tx, ctx.user.id, ctx.user.clerkUserId, input)") < read.indexOf("await tx.testRun.findUniqueOrThrow"));
  assert.ok(read.includes("organization: { select: { stepFieldLabels: true } }"));
  assert.ok(!read.includes("organization: true"));
  assert.ok(read.includes('isolationLevel: "RepeatableRead", timeout: 20000'));
});
test("complete current scope echoes and response byte refusal never return a truncated procedure", () => {
  assert.ok(read.includes("...access,"));
  assert.ok(read.includes('Buffer.byteLength(JSON.stringify(response), "utf8") > 16 * 1024 * 1024'));
  assert.ok(read.includes("No partial procedure or evidence was substituted"));
  assert.ok(read.includes("executionContext.caseDefinitions.length !== run.manualTestCaseIds.length"));
  assert.ok(read.includes("new Set(executionContext.caseDefinitions.map(c => c.testCaseId)).size"));
  assert.ok(read.includes("No current case wording was substituted"));
  assert.ok(read.indexOf("Buffer.byteLength(JSON.stringify(response)") < read.indexOf("return response;"));
  assert.ok(!read.includes("executionContext?.caseDefinitions.slice"));
});
test("new scoped view does not itself change result or revision histories", () => {
  for (const forbidden of ["testResult.update", "testResult.delete", "testResult.create", "manualCaseResultRevision.create", "manualStepResultRevision.create", "testCase.update"])
    assert.ok(!read.includes(forbidden), forbidden);
  assert.ok(read.includes("readRunExperienceSnapshot"));
  assert.ok(read.includes("boundedCurrentStepBytes"));
});
