import { test } from "node:test";
import assert from "node:assert/strict";
import { manualStartDefinitivelyRejected } from "./manual-run-start.ts";
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
