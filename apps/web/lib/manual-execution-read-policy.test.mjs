// SOURCE ONLY. Authored NOT RUN; actual role/cache/native integration remains mandatory.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { manualExecutionReadMatches } from "./manual-execution-read-policy.ts";
const input = { projectId: "p", testRunId: "r", organizationId: "o", clerkActorId: "actor", requestKey: "key",
  ready: true, error: false, fetching: false, paused: false };
const response = { projectId: "p", testRunId: "r", organizationId: "o", originalOrganizationId: "o", clerkActorId: "actor", readRequestKey: "key" };
test("only exact fresh original native scope response is presentable, without write permission inference", () => {
  assert.equal(manualExecutionReadMatches(input, response), true);
  assert.equal(manualExecutionReadMatches(input, { ...response, canWrite: false }), true);
});
test("missing actor/org/response and failed/fetching/paused/unready cache cannot reveal old bodies", () => {
  assert.equal(manualExecutionReadMatches(input), false);
  for (const organizationId of [undefined, ""]) assert.equal(manualExecutionReadMatches({ ...input, organizationId }, response), false);
  for (const clerkActorId of [undefined, ""]) assert.equal(manualExecutionReadMatches({ ...input, clerkActorId }, response), false);
  for (const field of ["error", "fetching", "paused"]) assert.equal(manualExecutionReadMatches({ ...input, [field]: true }, response), false);
  assert.equal(manualExecutionReadMatches({ ...input, ready: false }, response), false);
});
test("foreign project/run/tenant/original tenant/actor/request echoes refuse without rebind", () => {
  for (const field of ["projectId", "testRunId", "organizationId", "originalOrganizationId", "clerkActorId", "readRequestKey"])
    assert.equal(manualExecutionReadMatches(input, { ...response, [field]: "foreign" }), false);
});
const native = readFileSync(new URL("../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("./use-manual-execution-access.ts", import.meta.url), "utf8");
const step = readFileSync(new URL("../components/StepExecutionPanel.tsx", import.meta.url), "utf8");
test("original actor/organization pin and fresh response gate protect reads and current writes", () => {
  for (const text of ["!origin && actorReady && projectReady && canRead", "userId !== origin.clerkActorId", "origin.organizationId", 'member?.seatType === "FULL"', '"READ_ONLY"', "!project.error && !project.isFetching && !project.isPaused", "!organizations.error && !organizations.isFetching && !organizations.isPaused"]) assert.ok(hook.includes(text), text);
  assert.ok(!hook.includes("setOrigin(undefined)"));
  for (const text of ["originalOrganizationId: access.origin?.organizationId", "expectedClerkActorId: access.origin?.clerkActorId", "enabled: access.ready, staleTime: 0, retry: false", "manualExecutionReadMatches", "dataQuery.data?.canWrite === true", "if (!accessNow.current.canEdit)", "Private cached procedures and observations are hidden"]) assert.ok(native.includes(text), text);
});
test("withheld case/step/retest content retains mounted original draft/request state instead of dropping rows", () => {
  for (const text of ["{readable && <>", "readable={readable}", "readScope={readInput}", "active={readable && expanded && !stepMode}", "active={readable} canRetest", 'key={`${projectId}:${testRunId}:${tc.testCaseId}`}']) assert.ok(native.includes(text), text);
  assert.ok(!native.includes("readable && data.cases.map"));
  assert.ok(native.includes('const [retainedNativeData, setRetainedNativeData] = useState<RouterOutputs["manualExecution"]["getForExecution"] | undefined>'));
  assert.ok(native.includes("if (readable && dataQuery.data && retainedNativeData !== dataQuery.data) setRetainedNativeData(dataQuery.data)"));
  assert.ok(native.includes("const data = readable ? dataQuery.data : retainedNativeData"));
  assert.ok(!native.includes("retainedNativeData.current"), "Mounted data is ordinary render state, not render-time ref reads/writes");
  assert.ok(native.includes("useLayoutEffect(() => { accessNow.current = { readable, canEdit, ready: access.ready }; }, [readable, canEdit, access.ready])"));
  for (const text of ["if (!readable) return null", "enabled: readable && open && evidenceOpen", "{ testRunId, ...readScope }", "if (readableNow.current) window.open", "const [attempt, setAttempt]"]) assert.ok(step.includes(text), text);
  assert.ok(!step.includes("if (!readable) setAttempt(null)"));
});
test("later same-run result corrections do not unmount a retained separate-retest request", () => {
  assert.ok(native.includes("if (!readable || !dataQuery.data) return"));
  assert.ok(native.includes("new Set([...current, ...qualifying])"));
  assert.ok(native.includes("retainedRetestCases.has(tc.testCaseId) || tc.currentResult?.status"));
  assert.ok(!native.includes("setRetainedRetestCases(new Set(qualifying))"));
});
