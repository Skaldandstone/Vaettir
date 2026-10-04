// SOURCE ONLY. Real Clerk/QueryClient rendering and response-loss acceptance remain morning gates.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
// Normalize layout whitespace only; every identity/error/state token remains required.
const source = readFileSync(new URL("../components/TestCaseProcedureReimport.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
const service = readFileSync(new URL("../../api/src/services/caseProcedureReimport.ts", import.meta.url), "utf8");
test("private retained procedure comparisons require fresh current project, membership, actor and full editor", () => {
  for (const literal of ["useAuth()", "!project.error && !project.isFetching && !project.isPaused", "!organizations.error && !organizations.isFetching && !organizations.isPaused",
    "origin.organizationId === project.data?.organizationId", "origin.clerkActorId === userId", "const privateReady = editorReady && !paused && !accessRejected",
    "value.actorClerkUserId === origin.clerkActorId", "scopeNow.current.open", "{!privateReady ?", "{previewReady && preview &&", "{resultReady && result ?"])
    assert.ok(source.includes(literal), literal);
  assert.ok(!source.includes("setOrigin(null)"));
  assert.ok(source.includes("if (accessRejection(error)) setAccessRejected(true)"));
  assert.ok(source.includes("freshProject.error || freshProject.isFetching || freshProject.isPaused"));
  assert.ok(source.includes("if (!retained) { setReviewInvalid(true); setConfirmed(false); }"));
});

test("committed scope publication and state generation deny late file/review results after an identity return", () => {
  assert.match(source, /\[scopeState, setScopeState\] = useState/);
  assert.match(source, /scopeState.generation \+ 1/);
  assert.doesNotMatch(source, /scopeState\.current/);
  assert.match(source, /useLayoutEffect\(\(\) => \{ scopeNow.current = \{/);
  assert.match(source, /return \(\) => \{ scopeNow.current = \{ open: false, accessReady: false, editorReady: false,[\s\S]*?generation: -1/);
  assert.match(source, /scopeNow.current.generation === scopeAtLaunch/);
  const parseStart = source.indexOf("rows = JSON.parse(value)");
  const parseEnd = source.indexOf("if (Array.isArray(rows)", parseStart);
  assert.ok(parseStart >= 0 && parseEnd > parseStart);
  assert.doesNotMatch(source.slice(parseStart, parseEnd), /<ol>|<li|<p>/);
  assert.match(source, /Array.isArray\(rows\) && rows.every\(\(row\) => typeof row === "string"\)/);
});
test("unknown UUID retains exact old or scoped approval, matched ACK precedes independently caught refresh", () => {
  for (const literal of ["const attempt = pending ?? {", "expectedScope: { ...origin! }", "retainedTraceabilityReceipt(attempt, error)",
    "output.requestId !== attempt.input.requestId", "attempt.input.expectedScope ?? origin!", "output.actorClerkUserId !== expected.clerkActorId",
    "onClose={() => setOpen(false)}", "Restoration is confirmed. Refreshing case lists or history failed"])
    assert.ok(source.includes(literal), literal);
  const ack = source.indexOf("setResult(output)");
  assert.ok(ack > source.indexOf("output.requestId !== attempt.input.requestId"));
  const refresh = /void Promise\.resolve\(\)\s*\.then\(\(\) =>\s*Promise\.all\(\[/.exec(source);
  assert.ok(refresh && refresh.index > ack);
  const refreshBody = source.slice(refresh.index);
  assert.match(refreshBody, /\.catch\(\(\) => setNotice\(/);
  assert.doesNotMatch(refreshBody, /approveMutation\.mutateAsync/);
});
test("locked scope precedes body/replay and legacy receipt preserves its own original tenant", () => {
  const start = service.indexOf("export async function approveProcedureReimport");
  const lock = service.indexOf("const scope = await lockedScope", start);
  const parse = service.indexOf("const bundle = readBundle", lock);
  const receipt = service.indexOf("tx.auditLog.findFirst", lock);
  assert.ok(lock > start && parse > lock && receipt > parse);
  assert.ok(service.includes("receipt.organizationId !== scope.organizationId"));
  assert.ok(service.includes("input.expectedScope.clerkActorId !== actor.clerkUserId"));
  assert.ok(service.includes("return { ...saved.result, replayed: true, ...scope }"));
});
