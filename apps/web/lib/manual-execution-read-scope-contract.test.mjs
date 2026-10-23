// Source contracts authored NOT RUN; not migrated/authenticated/runtime proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const router = readFileSync(new URL("../../api/src/routers/manualExecution.ts", import.meta.url), "utf8");
const read = router.slice(router.indexOf("getForExecution: protectedProcedure"), router.indexOf("recordResult: protectedProcedure"));
const projection = readFileSync(new URL("../../api/src/services/manualExecutionCurrentProjection.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../api/src/services/manualRunCurrentReadSchema.ts", import.meta.url), "utf8");
test("bounded current actor/native scope locks precede private native execution body projection", () => {
  assert.ok(read.includes(".input(manualExecutionReadScopeInputSchema)"));
  assert.ok(read.includes(".output(manualExecutionCurrentOutputSchema)"));
  assert.ok(read.includes("readManualExecutionCurrentProjection(tx, ctx.user.id, ctx.user.clerkUserId, input)"));
  assert.ok(schema.includes("manualExecutionReadScopeOutputSchema.extend"));
  const admission = projection.indexOf("await lockManualExecutionReadScope("), body = projection.indexOf("await tx.testRun.findUniqueOrThrow");
  assert.ok(admission >= 0 && body > admission);
  assert.match(projection.slice(admission, body), /tx,\s*actorId,\s*clerkActorId,\s*input,/);
  assert.ok(projection.includes("organization: { select: { stepFieldLabels: true } }"));
  assert.ok(!projection.includes("organization: true"));
  assert.ok(read.includes('isolationLevel: "RepeatableRead", timeout: 20000'));
});
test("complete current scope echoes and response byte refusal never return a truncated procedure", () => {
  assert.ok(projection.includes("...access,"));
  assert.ok(projection.includes('Buffer.byteLength(JSON.stringify(response), "utf8") > 16 * 1024 * 1024'));
  assert.ok(projection.includes("No partial procedure or evidence was substituted"));
  assert.ok(projection.includes("executionContext.caseDefinitions.length !== run.manualTestCaseIds.length"));
  assert.ok(projection.includes("new Set(executionContext.caseDefinitions.map(c => c.testCaseId)).size"));
  assert.ok(projection.includes("No current case wording was substituted"));
  assert.ok(projection.indexOf("Buffer.byteLength(JSON.stringify(response)") < projection.indexOf("return response;"));
  assert.ok(!projection.includes("executionContext?.caseDefinitions.slice"));
});
test("new scoped view does not itself change result or revision histories", () => {
  for (const forbidden of ["testResult.update", "testResult.delete", "testResult.create", "manualCaseResultRevision.create", "manualStepResultRevision.create", "testCase.update"])
    assert.ok(!read.includes(forbidden) && !projection.includes(forbidden), forbidden);
  assert.ok(projection.includes("readRunExperienceSnapshot"));
  assert.ok(projection.includes("boundedCurrentStepBytes"));
});
