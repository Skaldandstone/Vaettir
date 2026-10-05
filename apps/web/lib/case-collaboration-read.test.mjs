import test from "node:test";
import assert from "node:assert/strict";
import { currentCollaborationRead } from "./case-collaboration-read.ts";
import { manualStartDefinitivelyRejected } from "./manual-run-start.ts";
const origin = { projectId: "synthetic-project", caseId: "synthetic-case", organizationId: "synthetic-org", clerkActorId: "synthetic-actor" };
const data = { projectId: origin.projectId, caseId: origin.caseId, readScope: { projectId: origin.projectId, organizationId: origin.organizationId, actorId: "native-user", actorClerkUserId: origin.clerkActorId }, items: [{ body: "Private synthetic comment" }] };
const query = { data, error: null, isFetching: false, isPaused: false };
test("comments require a fresh current read, not a cached body after revocation", () => {
  assert.equal(currentCollaborationRead(query, origin), data);
  for (const patch of [{ error: Error("Forbidden") }, { isFetching: true }, { isPaused: true }]) assert.equal(currentCollaborationRead({ ...query, ...patch }, origin), undefined);
  assert.equal(currentCollaborationRead(query, null), undefined);
});
test("old account, organization and case echoes never acquire current ownership", () => {
  for (const patch of [{ clerkActorId: "other" }, { organizationId: "other" }, { caseId: "other" }, { projectId: "other" }]) assert.equal(currentCollaborationRead(query, { ...origin, ...patch }), undefined);
  assert.equal(currentCollaborationRead({ ...query, data: { ...data, readScope: undefined } }, origin), undefined);
});
test("first definitive refusal permits draft editing but never discards an ambiguous receipt", () => {
  for (const code of ["BAD_REQUEST", "CONFLICT", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "PRECONDITION_FAILED"]) {
    assert.equal(manualStartDefinitivelyRejected({ data: { code } }, false), true);
    assert.equal(manualStartDefinitivelyRejected({ data: { code } }, true), false);
  }
  assert.equal(manualStartDefinitivelyRejected(Error("Network failed"), false), false);
  assert.equal(manualStartDefinitivelyRejected({ data: { code: "INTERNAL_SERVER_ERROR" } }, false), false);
});
