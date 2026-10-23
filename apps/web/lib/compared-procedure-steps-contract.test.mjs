// Source assertions authored only. No execution or rendered acceptance overnight.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const component = readFileSync(
  new URL("../components/TestCaseProcedureReimport.tsx", import.meta.url),
  "utf8",
);
const presentation = component.slice(
  component.indexOf("function ProcedureValue("),
  component.indexOf("export function TestCaseProcedureReimport("),
);
test("complete comparison uses all-or-nothing parsing and preserves raw unsupported values", () => {
  assert.ok(presentation.includes("readComparedProcedureSteps(value)"));
  assert.ok(presentation.includes("if (rows !== null)"));
  assert.ok(presentation.includes("{value}"));
  assert.match(presentation, /No\s+rows or fields were omitted/);
  assert.ok(!presentation.includes("return null"));
  assert.ok(!presentation.includes(".filter("));
  assert.ok(!presentation.includes(".sort("));
});
test("accessible full-column review distinguishes empty, absent and reference-only media", () => {
  for (const heading of [
    "Step",
    "Action",
    "Expected data",
    "Expected result",
    "Response",
    "Media IDs",
  ])
    assert.ok(presentation.includes(`<th>${heading}</th>`));
  assert.ok(presentation.includes('role="region"'));
  assert.ok(presentation.includes("tabIndex={0}"));
  assert.ok(presentation.includes("<caption>"));
  assert.ok(presentation.includes("String(row.order)"));
  assert.ok(presentation.includes('"Not supplied"'));
  assert.ok(presentation.includes("<em>Empty string</em>"));
  assert.ok(presentation.includes("row.mediaAttachmentIds.map"));
  assert.ok(!presentation.includes("fetch("));
  assert.ok(!presentation.includes("dangerouslySetInnerHTML"));
});
