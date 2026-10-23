import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { retainedTraceabilityReceipt } from "./traceability-receipt.ts";

const input = {
  version: 4,
  requestId: "frozen-request",
  target: { nativeId: "FEAT-42", title: "Human-reviewed feature" },
};
test("an unknown response freezes the exact reviewed input and request identity", () => {
  const retained = retainedTraceabilityReceipt(
    { input, uncertain: false },
    new Error("Connection lost"),
  );
  assert.equal(retained.input, input);
  assert.equal(retained.uncertain, true);
});
test("unknown then forbidden cannot prove an earlier approved write was not applied", () => {
  const unknown = retainedTraceabilityReceipt(
    { input, uncertain: false },
    new Error("Lost response"),
  );
  for (const code of [
    "FORBIDDEN",
    "UNAUTHORIZED",
    "CONFLICT",
    "BAD_REQUEST",
    "NOT_FOUND",
  ]) {
    const retained = retainedTraceabilityReceipt(unknown, { data: { code } });
    assert.equal(retained.input, input);
    assert.equal(retained.uncertain, true);
  }
});
test("an initial definite rejection permits explicit refresh and a newly reviewed draft", () => {
  for (const code of [
    "CONFLICT",
    "BAD_REQUEST",
    "NOT_FOUND",
    "FORBIDDEN",
    "UNAUTHORIZED",
    "PRECONDITION_FAILED",
    "TOO_MANY_REQUESTS",
  ])
    assert.equal(
      retainedTraceabilityReceipt(
        { input, uncertain: false },
        { data: { code } },
      ),
      null,
    );
});
test("unexpected server and malformed errors retain the exact pending request", () => {
  for (const cause of [
    null,
    undefined,
    {},
    { data: { code: "INTERNAL_SERVER_ERROR" } },
  ])
    assert.equal(
      retainedTraceabilityReceipt({ input, uncertain: false }, cause).input,
      input,
    );
});
test("both panels retry frozen inputs before allowing edits or baseline replacement", () => {
  const source = readFileSync(
    new URL("../components/CaseTraceabilityPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /write\(attempt\.input\)/);
  assert.match(
    source,
    /receipt\s*\?\?\s*\{\s*input: structuredClone\(input\),\s*uncertain: false,?\s*\}/,
  );
  assert.match(source, /disabled=\{draftLocked\}/);
  assert.match(source, /reviewedSave\.pending\s*\?\s*\(?\s*"Outcome unknown/);
  assert.match(source, /dismissible=\{!busy && !reviewedRemove\.pending\}/);
});
