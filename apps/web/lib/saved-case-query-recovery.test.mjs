import test from "node:test";
import assert from "node:assert/strict";
import { retainSavedQueryRequest } from "./saved-case-query-recovery.ts";
test("saved query response-loss recovery never discards a prior unconfirmed request", () => {
  for (const code of ["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED", "FORBIDDEN", "NOT_FOUND", "INTERNAL_SERVER_ERROR"])
    assert.equal(retainSavedQueryRequest(true, { data: { code } }), true);
});
test("only definite first validation/CAS refusals release a captured query edit", () => {
  for (const code of ["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED"])
    assert.equal(retainSavedQueryRequest(false, { data: { code } }), false);
  for (const error of [new Error("Transport lost"), { data: { code: "FORBIDDEN" } }, { data: { code: "NOT_FOUND" } }])
    assert.equal(retainSavedQueryRequest(false, error), true);
});
