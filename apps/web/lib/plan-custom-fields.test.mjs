import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { describeRetainedPlanValue, finitePlanNumber, planCustomFields, removePlanField, removePlanStringRow, replacePlanField, replacePlanStringRow } from "./plan-custom-fields.ts";
const schema = { type: "object", properties: { notes: { type: "string" }, enabled: { type: "boolean" }, budget: { type: "number" }, areas: { type: "array", items: { type: "string" } } } };
test("supported field types stay native and preserve empty/false/zero values", () => {
  const values = { notes: "", enabled: false, budget: 0, areas: ["", " a,b ", "same", "same", "multi\nline"] };
  const fields = planCustomFields(schema, values);
  assert.deepEqual(fields.map(field => field.kind), ["string", "boolean", "number", "string-array"]);
  assert.deepEqual(fields.map(field => field.value), Object.values(values));
  assert.ok(fields.every(field => field.present));
  assert.deepEqual(values.areas, ["", " a,b ", "same", "same", "multi\nline"]);
});
test("missing fields remain missing until deliberate edits, not NULL/empty/false coercions", () => {
  assert.ok(planCustomFields(schema, {}).every(field => !field.present && field.value === undefined));
  assert.deepEqual(planCustomFields(schema, {}), planCustomFields(schema, {}));
  for (const value of [null, undefined, "false", 0]) assert.equal(planCustomFields({ properties: { enabled: { type: "boolean" } } }, { enabled: value })[0].kind, "retained");
  assert.equal(describeRetainedPlanValue(null, true), "null");
  assert.equal(describeRetainedPlanValue(undefined, true), "undefined (retained native value)");
  assert.match(describeRetainedPlanValue(undefined, false), /Not set/);
});
test("unsupported schemas and mismatched arrays are explicit read-only with original values", () => {
  const values = { areas: ["keep", 4, "", null, " keep "] };
  for (const prop of [{ type: "array" }, { type: "array", items: { type: "number" } }, { type: "array", items: { type: "string" } }, { type: "string", enum: ["x"] }]) {
    const field = planCustomFields({ properties: { areas: prop } }, values)[0];
    assert.equal(field.kind, "retained"); assert.equal(field.value, values.areas); assert.match(field.reason, /retained read-only/);
  }
  for (const root of [null, [], { type: "string" }, { properties: [] }, { type: "object", oneOf: [] }]) assert.equal(planCustomFields(root, values)[0].kind, "retained");
  assert.deepEqual(values.areas, ["keep", 4, "", null, " keep "]);
});
test("one exact row edit/add/remove preserves commas, newlines, whitespace, duplicates, order and siblings", () => {
  const original = { areas: ["", " a,b ", "same", "same", "line\nnext"], other: { native: [null, 3, ""] } };
  const before = structuredClone(original);
  const edited = replacePlanField(original, "areas", replacePlanStringRow(original.areas, 2, " keep\nthis,exact "));
  assert.deepEqual(edited.areas, ["", " a,b ", " keep\nthis,exact ", "same", "line\nnext"]);
  assert.equal(edited.other, original.other);
  const added = replacePlanField(edited, "areas", [...edited.areas, ""]);
  assert.equal(added.areas.at(-1), "");
  assert.deepEqual(removePlanStringRow(added.areas, 3), ["", " a,b ", " keep\nthis,exact ", "line\nnext", ""]);
  assert.deepEqual(original, before);
  for (const index of [-1, 6, 0.1]) assert.throws(() => replacePlanStringRow(original.areas, index, "x"), /existing exact row/);
});
test("unknown sibling fields survive edits and cannot acquire a writable inferred schema", () => {
  const values = { enabled: false, unknown: { nested: [null, { a: "b" }] } };
  const field = planCustomFields(schema, values).find(field => field.key === "unknown");
  assert.equal(field.kind, "retained"); assert.equal(field.value, values.unknown);
  assert.equal(replacePlanField(values, "enabled", true).unknown, values.unknown);
  assert.deepEqual(removePlanField(values, "enabled"), { unknown: values.unknown });
  assert.equal(values.enabled, false);
});
test("finite-number input rejects blank, invalid and nonfinite text without converting it to zero", () => {
  for (const value of ["", " ", "NaN", "Infinity", "1e309", "0x10", "1,000", "-", "1e", " 5 "]) assert.equal(finitePlanNumber(value), null, value);
  assert.equal(finitePlanNumber("0"), 0); assert.equal(finitePlanNumber("-0.5"), -0.5); assert.equal(finitePlanNumber("1e3"), 1000);
  for (const value of [Infinity, NaN, "1", null]) assert.equal(planCustomFields({ properties: { n: { type: "number" } } }, { n: value })[0].kind, "retained");
});
test("generic plan mount keeps existing save flow and does not use comma parsing", () => {
  const component = readFileSync(new URL("../components/PlanCustomFieldsForm.tsx", import.meta.url), "utf8");
  const parent = readFileSync(new URL("../components/TestPlanDetailContent.tsx", import.meta.url), "utf8");
  assert.match(component, /type="checkbox"/); assert.match(component, /<textarea/);
  assert.match(component, /Set false explicitly/); assert.match(component, /Set empty/);
  assert.doesNotMatch(component, /\.split\(|\.trim\(|filter\(Boolean\)/);
  assert.match(parent, /<PlanCustomFieldsForm schema=\{plan\.testPlanType\.fieldSchema\} values=\{customFields\} onChange=\{setCustomFields\}/);
  assert.match(parent, /updateMutation\.mutateAsync\(\{ id, status: status as never, \.\.\.legacyPlanMetadataPatch\(plan\.customFields, draft\.customFields\) \}\)/);
  assert.doesNotMatch(parent, /updateMutation\.mutateAsync\(\{[^}]*\b(?:name|description)\b/);
  assert.match(parent, /<PlanHeaderEditor key=\{`\$\{plan\.projectId\}:\$\{id\}`\}/);
});
