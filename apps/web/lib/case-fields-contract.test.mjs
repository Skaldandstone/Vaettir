// Source contracts authored tonight, not executed. Rendered cache/keyboard checks follow in the morning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const file = (name) => readFileSync(new URL(name, import.meta.url), "utf8");

test("each metadata draft change invalidates review through a stable callback", () => {
  const source = file("../components/CaseCustomFields.tsx");
  const callback = source.match(
    /const updateDraft = useCallback\(\(value: CaseFieldFormDraft \| null\) => \{([\s\S]*?)\}, \[\]\);/,
  );
  assert.ok(
    callback,
    "Use a stable callback: an inline callback would retrigger the child publication effect",
  );
  assert.match(source, /onChange=\{updateDraft\}/);
  assert.doesNotMatch(source, /onChange=\{setDraft\}/);
  const changes = [],
    confirmations = [];
  const publish = runInNewContext(`(value) => {${callback[1]}}`, {
    setDraft: (value) => changes.push(value),
    setConfirmed: (value) => confirmations.push(value),
    draftRef: { current: null },
    confirmedRef: { current: true },
    busyRef: { current: false },
    pendingRef: { current: null },
  });
  const first = { customFields: { approved: false, count: 0 }, ready: true };
  const altered = { ...first, customFields: { approved: true, count: 0 } };
  publish(first);
  publish(altered);
  publish(null);
  assert.deepEqual(changes, [first, altered, null]);
  assert.deepEqual(confirmations, [false, false, false]);
});
test("typed native case fields use fresh scoped definitions and retain uncertain receipts", () => {
  const source = file("../components/CaseCustomFields.tsx");
  assert.match(
    file("./use-case-field-access.ts"),
    /!query\.error\s*&&\s*!query\.isFetching\s*&&\s*!query\.isPaused/,
  );
  assert.match(
    source,
    /expectedSchemaHash: currentDraft!\.expectedFieldSchemaHash/,
  );
  assert.match(
    source,
    /expectedValueHash: currentDraft!\.expectedCustomFieldRevision/,
  );
  assert.match(source, /retainedCaseFieldReceipt\(attempt,\s*error\)/);
  assert.match(source, /key=\{`\$\{projectId\}:\$\{caseId\}`\}/);
  assert.match(source, /<CaseFieldValueControls/);
  const controls = file("../components/CaseFieldValueControls.tsx");
  assert.match(controls, /resolved\.readOnly/);
  assert.match(controls, /retained unknown metadata, read-only/);
  assert.match(controls, /widget === "NUMBER"/);
  assert.match(controls, /inputMode="decimal"/);
  assert.match(
    source,
    /Procedure\s+version comparison and restore preserve current\s+metadata/,
  );
});
test("project schema changes require current Owner Admin, impact, reason and explicit confirmation", () => {
  const source = file("../components/ProjectCaseFields.tsx");
  assert.match(source, /!fresh\.canConfigure/);
  assert.match(
    source,
    /result\.expectedSchemaHash\s*!==\s*originalBaseline\.expectedSchemaHash/,
  );
  assert.match(source, /const originalBaseline = baseline/);
  assert.match(source, /Review impact before saving/);
  assert.match(source, /expectedImpactHash:\s*impact!\.expectedImpactHash/);
  assert.match(source, /I reviewed the retained incomplete cases/);
  assert.match(source, /retainedCaseFieldReceipt\(attempt,\s*error\)/);
  assert.match(source, /Retire \(retain original values read-only\)/);
});
test("authoring and inspector mount required metadata without replacing procedures or prerequisites", () => {
  const form = file("../components/TestCaseForm.tsx");
  assert.match(form, /!caseFieldsDraft\?\.ready/);
  assert.match(form, /customFields: caseFieldsDraft\.customFields/);
  assert.match(
    form,
    /expectedFieldSchemaHash: caseFieldsDraft\.expectedFieldSchemaHash/,
  );
  assert.match(form, /onChange=\{setCaseFieldsDraft\}/);
  const inspector = file("../components/TestCaseDetailContent.tsx");
  assert.match(
    inspector,
    /<CaseCustomFields projectId=\{projectId\} caseId=\{tc\.id\}/,
  );
  assert.match(inspector, /<TestCasePrerequisites/);
  assert.match(inspector, /<DatasetSection/);
});
test("reviewed preset metadata applies once only to a fresh current-schema create draft", () => {
  const fields = file("../components/CaseCustomFields.tsx");
  assert.match(fields, /initial\?: ReviewedCaseFieldDefaults/);
  assert.match(fields, /!baseline &&\s*fresh &&/);
  assert.match(fields, /caseId !== undefined\s*\|\|\s*!fresh\.canEdit/);
  assert.match(
    fields,
    /initial\.expectedSchemaHash !== fresh\.expectedSchemaHash/,
  );
  assert.match(fields, /!field\.retired && field\.key === key/);
  assert.match(
    fields,
    /const admittedValues = \{ \.\.\.fresh\.values, \.\.\.initial\.values \}/,
  );
  assert.match(fields, /Start with current fields without preset defaults/);
  assert.match(
    fields,
    /current\.active && unchanged && !current\.initialError/,
  );
  const form = file("../components/TestCaseForm.tsx");
  assert.match(
    form,
    /initial=\{mode\s*===\s*"create"\s*&&\s*!testCaseId\s*\?\s*initialCustomFields\s*:\s*undefined\}/,
  );
});
