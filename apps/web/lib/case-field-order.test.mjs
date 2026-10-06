import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reorderCaseFieldDraft } from "./case-field-order.ts";
const field = (key, extra = {}) => Object.freeze({ key, label: key, type: "TEXT", required: false, retired: false, options: Object.freeze([]), ...extra });

test("Up/Down preserve exact definitions, choices and original array without new schema properties", () => {
  const original = Object.freeze([field("one"), field("two", { type: "CHOICE", options: Object.freeze(["A, B", "Original whitespace "]) }), field("three", { retired: true })]);
  const up = reorderCaseFieldDraft(original, "two", "UP");
  assert.deepEqual(up.map(value => value.key), ["two", "one", "three"]);
  assert.equal(up[0], original[1]); assert.equal(up[0].options, original[1].options);
  const down = reorderCaseFieldDraft(up, "two", "DOWN");
  original.forEach((value, index) => assert.equal(value, down[index]));
  assert.deepEqual(original.map(value => value.key), ["one", "two", "three"]);
});

test("stable-key lookup moves the requested field after an earlier reorder, not its former index", () => {
  const original = [field("one"), field("two"), field("three")];
  const first = reorderCaseFieldDraft(original, "one", "DOWN");
  const second = reorderCaseFieldDraft(first, "one", "DOWN");
  assert.deepEqual(second.map(value => value.key), ["two", "three", "one"]);
});

test("boundary moves, missing keys, invalid operation and duplicate identities refuse atomically", () => {
  const original = [field("one"), field("two")];
  for (const [fields, key, direction] of [[original, "one", "UP"], [original, "two", "DOWN"], [original, "missing", "UP"], [original, "one", "INVALID"], [[field("one"), field("one")], "one", "DOWN"], [[field("constructor"), field("other")], "constructor", "DOWN"], [[], "one", "DOWN"]]) assert.equal(reorderCaseFieldDraft(fields, key, direction), null);
  assert.deepEqual(original.map(value => value.key), ["one", "two"]);
});

test("twenty retained definitions are supported, twenty-one refuse without partial ordering", () => {
  const fields = Array.from({ length: 20 }, (_, index) => field(`field_${index}`));
  const moved = reorderCaseFieldDraft(fields, "field_19", "UP");
  assert.equal(moved.length, 20); assert.equal(moved[18], fields[19]);
  assert.equal(reorderCaseFieldDraft([...fields, field("overflow")], "field_19", "UP"), null);
});

test("UI ordering remains an original-scope local draft action, preserving in-progress key and approval protocol", () => {
  const source = readFileSync(new URL("../components/ProjectCaseFields.tsx", import.meta.url), "utf8");
  const action = source.slice(source.indexOf("function moveField("), source.indexOf("async function compare("));
  assert.match(action, /busy \|\| pending \|\| !baseline \|\| !fresh/);
  assert.match(action, /fresh.expectedSchemaHash !== baseline.expectedSchemaHash/);
  assert.match(action, /!access.canConfigure \|\| !original \|\| !access.owns\(original, "configure"\)/);
  assert.match(action, /reorderCaseFieldDraft\(schema.fields, key, direction\)/);
  assert.match(action, /const selectedKey = schema.fields\[selected\]\?\.key/);
  assert.match(action, /setSelected\(ordered.findIndex\(value => value.key === selectedKey\)\)/);
  assert.match(action, /setImpact\(null\);\s*setConfirmed\(false\)/);
  assert.doesNotMatch(action, /mutate|refetch|setPending|setField|options:|default:/);
  assert.match(source, /aria-label=\{`Move \$\{value.label\} \(\$\{value.key\}\) up in field order`\}/);
  assert.match(source, /aria-label=\{`Move \$\{value.label\} \(\$\{value.key\}\) down in field order`\}/);
  assert.match(source, /Review impact before saving/); assert.match(source, /expectedImpactHash: impact!.expectedImpactHash/);
  assert.match(source, /requestId: crypto.randomUUID\(\)/); assert.match(source, /configure.mutateAsync\(attempt.input\)/);
});
