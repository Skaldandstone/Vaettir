// SOURCE ONLY: authored static contracts, not executed. Actual installed query
// cache / late actor / unknown response mounted checks remain morning gates.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui = readFileSync(new URL("../components/ManualRetestWizard.tsx", import.meta.url), "utf8");
const controller = readFileSync(new URL("./manual-retest-reviewed-controller.ts", import.meta.url), "utf8");
const reader = readFileSync(new URL("./use-manual-retest-reviewed-access.ts", import.meta.url), "utf8");

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
  for (const literal of ["!project.error && !project.isFetching && !project.isPaused", "!organizations.error && !organizations.isFetching && !organizations.isPaused", "sameManualRetestScope(origin, current)", "expectedScope={access.origin}", "openNow.current", "controller.view().readable", "reader.current()===snapshot", "!view.readable?<section>"]) assert.ok(ui.includes(literal), literal);
  for (const literal of ["!query.error && !query.isFetching && !query.isPaused", "admitRetestRead(query.data, input", "guard.revokeCache", "guard.revokeActions"]) assert.ok(reader.includes(literal), literal);
  assert.ok(ui.indexOf("!view.readable?<section>") < ui.indexOf("{view.known?<section>"));
  assert.ok(!ui.includes("if (!access.ready) setAttempt(null)"));
});
test("exact unknown UUID survives later typed refusal and approval is not silently rebound", () => {
  for (const literal of ["const held = this.pending ?? this.reviewed", "sameRetestOrigin(held.origin, this.original)", "this.pending = held; held.submitted = true", "if (definitive && !held.ambiguous && !wasSubmitted)", "else held.ambiguous = true", "verifiedReviewedRetestAck(held.envelope, response)"]) assert.ok(controller.includes(literal), literal);
  const start = ui.slice(ui.indexOf("async function start()"), ui.indexOf("function readConfirmedLinks"));
  assert.ok(!start.includes("setAttempt(null)"));
  assert.ok(controller.indexOf("verifiedReviewedRetestAck(held.envelope, response)") < controller.indexOf("this.known = { held, ack, published: false }"));
});
test("verified ACK remains separate from refresh failure and late scope never grants factual rendering", () => {
  assert.ok(controller.includes("Known ACK settles privately FIRST"));
  assert.ok(controller.includes('s!.projection === "LINKS"'));
  assert.ok(controller.includes("r.testRunId === this.known!.ack.testRunId"));
  assert.ok(ui.includes('reader.read("LINKS")'));
  assert.ok(ui.includes("controller.publishConfirmed(installedSession(),epoch"));
  assert.ok(ui.includes("Current relationships have not verified the retained target"));
  assert.ok(!ui.includes(".invalidate("));
  assert.ok(ui.includes("active={active&&canRetest&&access.ready&&access.canWrite}"));
});
