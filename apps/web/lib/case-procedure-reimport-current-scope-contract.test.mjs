// SOURCE ONLY. Real Clerk/QueryClient rendering and response-loss acceptance remain morning gates.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
// Normalize layout whitespace only; every identity/error/state token remains required.
const source = readFileSync(new URL("../components/TestCaseProcedureReimport.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
const service = readFileSync(new URL("../../api/src/services/caseProcedureReimport.ts", import.meta.url), "utf8");
const actorService = readFileSync(new URL("../../api/src/services/caseFieldReadScope.ts", import.meta.url), "utf8");
const reimportRouter = readFileSync(new URL("../../api/src/routers/caseProcedureReimport.ts", import.meta.url), "utf8");
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
  const scopeStart = service.indexOf("async function lockedScope(");
  const scopeEnd = service.indexOf("type Procedure", scopeStart);
  assert.ok(scopeStart >= 0 && scopeEnd > scopeStart);
  const scope = service.slice(scopeStart, scopeEnd);
  const projectLock = scope.indexOf("await lockCaseFieldProject(tx, userId, input.projectId)");
  const actorLock = scope.indexOf("const actorClerkUserId = await lockCurrentCaseFieldActor(tx, userId, authorized)");
  const projectRead = scope.indexOf("const project = await tx.project.findUniqueOrThrow");
  const scopeCheck = scope.indexOf("input.expectedScope.organizationId !== project.organizationId");
  const clerkCheck = scope.indexOf("input.expectedScope.clerkActorId !== actorClerkUserId");
  const refusal = scope.indexOf('throw new TRPCError({ code: "FORBIDDEN"');
  const scopeReturn = scope.indexOf("return { projectId: input.projectId, organizationId: project.organizationId, actorClerkUserId }");
  assert.ok(projectLock >= 0 && actorLock > projectLock && projectRead > actorLock);
  assert.ok(scopeCheck > projectRead && clerkCheck > scopeCheck && refusal > clerkCheck && scopeReturn > refusal);
  // Request authentication is independent of retained input scope, including
  // legacy callers omitting that scope and recovery of accepted exact UUIDs.
  for (const name of ["previewProcedureReimport", "approveProcedureReimport"])
    assert.match(reimportRouter, new RegExp(`${name}\\(ctx\\.prisma, ctx\\.user\\.id, input, \\{\\s*clerkActorId: ctx\\.user\\.clerkUserId,\\s*\\}\\)`));
  assert.equal((service.match(/const scope = await lockedScope\(tx, userId, input, authorized\)/g) ?? []).length, 2);
  const helperStart = actorService.indexOf("export async function lockCurrentCaseFieldActor(");
  const helperEnd = actorService.indexOf("export async function lockCaseFieldReadScope(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = actorService.slice(helperStart, helperEnd);
  for (const literal of ['length("clerkUserId") BETWEEN 1 AND 200', 'FROM "User" WHERE id=${userId} FOR SHARE',
    "!actor?.clerkUserId", "authorized !== undefined && actor.clerkUserId !== authorized.clerkActorId",
    'code: "FORBIDDEN"', "return actor.clerkUserId"])
    assert.ok(helper.includes(literal), literal);
  const previewStart = service.indexOf("export async function previewProcedureReimport");
  const previewLock = service.indexOf("const scope = await lockedScope", previewStart);
  const previewParse = service.indexOf("const bundle = readBundle", previewLock);
  const previewReview = service.indexOf("await review(tx, userId, input, bundle, scope.actorClerkUserId)", previewParse);
  assert.ok(previewStart >= 0 && previewLock > previewStart && previewParse > previewLock && previewReview > previewParse && previewReview < start);
  const caseLock = service.indexOf('SELECT id FROM "TestCase"', receipt);
  const approvalReview = service.indexOf("await review(tx, userId, input, bundle, scope.actorClerkUserId)", caseLock);
  assert.ok(caseLock > receipt && approvalReview > caseLock);
  assert.ok(service.includes("const requestHash = qualityProfileHash(input)"));
  assert.ok(service.includes("saved.requestHash !== requestHash"));
  assert.ok(service.includes("return { ...saved.result, replayed: true, ...scope }"));
});
