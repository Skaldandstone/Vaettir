import { test } from "node:test";
import assert from "node:assert/strict";
import { retainAnalysisRequest } from "./analysis-request-recovery.ts";
test("analysis retains unknown response requests and later typed refusals exactly", () => {
  assert.equal(retainAnalysisRequest(false, new Error("Response lost")), true);
  for (const code of ["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED"]) {
    assert.equal(retainAnalysisRequest(false, { data: { code } }), false);
    assert.equal(retainAnalysisRequest(true, { data: { code } }), true);
  }
  assert.equal(
    retainAnalysisRequest(false, { data: { code: "INTERNAL_SERVER_ERROR" } }),
    true,
  );
  // The final receipt read reauthorizes AFTER committing review/approval.
  for (const code of ["FORBIDDEN", "NOT_FOUND"])
    assert.equal(retainAnalysisRequest(false, { data: { code } }), true);
});
