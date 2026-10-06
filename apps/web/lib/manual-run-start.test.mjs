import { test } from "node:test";
import assert from "node:assert/strict";
import { manualStartDefinitivelyRejected, assertManualStartAcknowledgement } from "./manual-run-start.ts";
test("definitive first refusals permit scope repair, but never discard an earlier unknown acknowledgement", () => {
  for (const code of [
    "BAD_REQUEST",
    "CONFLICT",
    "FORBIDDEN",
    "UNAUTHORIZED",
    "NOT_FOUND",
    "PRECONDITION_FAILED",
  ]) {
    assert.equal(
      manualStartDefinitivelyRejected({ data: { code } }, false),
      true,
    );
    assert.equal(
      manualStartDefinitivelyRejected({ data: { code } }, true),
      false,
    );
  }
  for (const cause of [
    null,
    new Error("Lost response"),
    { data: { code: "INTERNAL_SERVER_ERROR" } },
    { data: { code: "TIMEOUT" } },
  ]) {
    assert.equal(manualStartDefinitivelyRejected(cause, false), false);
  }
});

test("run list acknowledgements require the original tenant, actor and UUID", () => {
  const request = { originalOrganizationId: "org", expectedClerkActorId: "clerk", idempotencyKey: "uuid" };
  assert.doesNotThrow(() => assertManualStartAcknowledgement({ testRunId: "manual_accepted", ...request }, request));
  for (const saved of [{ testRunId: "manual_accepted" }, { testRunId: "manual_accepted", ...request, idempotencyKey: "other" }, { testRunId: "manual_accepted", ...request, originalOrganizationId: "other" }, { testRunId: "ci", ...request }])
    assert.throws(() => assertManualStartAcknowledgement(saved, request), /same request/);
});
