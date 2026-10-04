// SOURCE ONLY. NOT RUN; real installed QueryClient/Clerk mounted checks remain mandatory.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const component = readFileSync(new URL("../components/TestCaseExecutionHistory.tsx", import.meta.url), "utf8");
const scope = readFileSync(new URL("../../api/src/services/caseExecutionHistoryScope.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("../../api/src/routers/caseExecutionHistory.ts", import.meta.url), "utf8");
test("current identity/page cache guards precede native private history and keep filters", () => {
  for (const literal of ["key={`${projectId}:${testCaseId}`}", "!originalOrganizationId && !originalClerkActorId", "expectedClerkActorId: originalClerkActorId",
    "!history.error && !history.isFetching && !history.isPaused", "history.data.actorClerkUserId === originalClerkActorId", "history.data.actorClerkUserId === userId",
    "history.data.requested === caseHistoryRequestKey(input)", "Cached evidence is hidden", "filter choices are preserved"])
    assert.ok(component.includes(literal), literal);
  assert.ok(!component.includes("setOriginalOrganizationId(undefined)")); assert.ok(!component.includes("setOriginalClerkActorId(undefined)"));
});
test("native configuration controls are progressive, literal and reset paging only after explicit apply", () => {
  for (const literal of ["Filter executions", "UTC {key} date", "Exact recorded manual configuration", "CI commits are not treated as build", "Apply filters",
    "setApplied(filterDraft); setAnchors([undefined])", 'boxSizing: "border-box"', "ManualRetestActions", "CaseObservationHistoryEntry", "testCaseId={page.testCase.id}", "displayId={page.testCase.displayId}"])
    assert.ok(component.includes(literal), literal);
  assert.ok(!component.includes("useMutation"));
});
test("fresh locked scope, server Clerk echo and bounded metadata gates are not client permissions", () => {
  assert.ok(scope.indexOf('FROM "Organization"') < scope.indexOf('FROM "Membership"'));
  assert.ok(scope.indexOf('FROM "Membership"') < scope.indexOf('FROM "Project"'));
  assert.ok(scope.includes("actor.clerkUserId !== authorized.clerkActorId"));
  assert.ok(scope.includes('["FULL", "READ_ONLY"].includes(members[0].seatType)'));
  assert.ok(scope.includes("population[0].count > 20000")); assert.ok(scope.includes("size[0].bytes > 4194304n"));
  assert.ok(scope.indexOf("size[0].bytes > 4194304n") < scope.indexOf("const summaries ="));
  assert.ok(router.includes("clerkActorId: ctx.user.clerkUserId"));
});
