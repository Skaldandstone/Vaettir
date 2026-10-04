// SOURCE ONLY: authored static contracts, not executed. Actual installed query
// cache / late actor / unknown response mounted checks remain morning gates.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui = readFileSync(new URL("../components/ManualRetestWizard.tsx", import.meta.url), "utf8");

test("retest actor/access/open event refs publish only after React commits their tracked scope", () => {
  for (const literal of ["useLayoutEffect(() => { actorNow.current = { actorReady, userId }; }, [actorReady, userId])", "useLayoutEffect(() => { accessNow.current = access; }, [access])", "useLayoutEffect(() => { openNow.current = open && active; }, [open, active])"]) assert.ok(ui.includes(literal), literal);
  assert.ok(!ui.includes("const accessNow = useRef(access); accessNow.current = access"));
  assert.ok(!ui.includes("const actorNow = useRef({ actorReady, userId }); actorNow.current"));
});
const access = readFileSync(new URL("../../api/src/services/manualRetestScope.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../../api/src/services/manualRetest.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("../../api/src/routers/manualRetest.ts", import.meta.url), "utf8");
test("original organization membership project actor locks precede private evidence and successful replay", () => {
  const org = access.indexOf('FROM "Organization"'), member = access.indexOf('FROM "Membership"'), project = access.indexOf('FROM "Project"'), actor = access.indexOf('FROM "User"');
  assert.ok(org >= 0 && member > org && project > member && actor > project);
  for (const literal of ["projects[0]?.organizationId !== organizationId", "actor.clerkUserId !== authenticatedClerkActorId", "actor.clerkUserId !== input.expectedScope.clerkActorId", 'member.seatType !== "FULL"']) assert.ok(access.includes(literal), literal);
  const start = service.slice(service.indexOf("export async function startManualRetest"));
  assert.ok(start.indexOf("lockManualRetestAccess") < start.indexOf("const [previousOwner]"));
  assert.ok(start.indexOf("return response(access, true)") < start.indexOf("const prepared = await prepareManualRetest"));
  assert.ok(start.indexOf("size[0].bytes > 2097152n") < start.indexOf("const previous ="));
  assert.ok(router.includes("ctx.user.clerkUserId"));
});
test("current project member and actor guards hide errored paused fetching or wrong-request private cache", () => {
  for (const literal of ["!project.error && !project.isFetching && !project.isPaused", "!organizations.error && !organizations.isFetching && !organizations.isPaused", "sameManualRetestScope(origin, current)", "!links.error && !links.isFetching && !links.isPaused", "verifiedManualRetestRead(linksInput, links.data)", "linksMismatch", "expectedScope: access.origin", "accessNow.current.ready", "openNow.current"]) assert.ok(ui.includes(literal), literal);
  assert.ok(ui.indexOf("!access.ready || accessRejected ?") < ui.indexOf("{receipt ?"));
  assert.ok(!ui.includes("if (!access.ready) setAttempt(null)"));
});
test("exact unknown UUID survives later typed refusal and approval is not silently rebound", () => {
  for (const literal of ["const request = attempt ??", "sameManualRetestScope(request.expectedScope, access.origin)", "setAttempt(request)", "if (definitive && !ambiguous && !unknown.current)", "unknown.current = true", "verifiedManualRetestAck(request, result)"]) assert.ok(ui.includes(literal), literal);
  const start = ui.slice(ui.indexOf("async function start()"), ui.indexOf("return ("));
  assert.ok(!start.includes("setAttempt(null)"));
  assert.ok(start.indexOf("verifiedManualRetestAck") < start.indexOf("setReceipt(result)"));
});
test("verified ACK remains separate from refresh failure and late scope never grants factual rendering", () => {
  assert.ok(ui.includes("Verified historical ACK is retained even after current UI scope changes"));
  const start = ui.slice(ui.indexOf("async function start()"), ui.indexOf("return ("));
  assert.ok(start.indexOf("setReceipt(result)") < start.indexOf("void Promise.all"));
  assert.ok(start.includes('.catch(() => setRefreshNotice("Retest creation is confirmed'));
  assert.ok(ui.includes("{refreshNotice && <p role=\"alert\">{refreshNotice}</p>}"));
  assert.ok(ui.includes("active={active && canRetest && access.ready && access.canWrite && !linksDenied && !linksMismatch && !links.isPaused}"));
});
