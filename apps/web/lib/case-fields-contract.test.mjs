// Source contracts authored tonight, not executed. Rendered cache/keyboard checks follow in the morning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const file = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
test("typed native case fields use fresh scoped definitions and retain uncertain receipts", () => {
  const source = file("../components/CaseCustomFields.tsx");
  assert.match(
    source,
    /!query\.error\s*&&\s*!query\.isFetching\s*&&\s*!query\.isPaused/,
  );
  assert.match(source, /expectedSchemaHash: draft!\.expectedFieldSchemaHash/);
  assert.match(
    source,
    /expectedValueHash: draft!\.expectedCustomFieldRevision/,
  );
  assert.match(source, /retainedTraceabilityReceipt\(attempt,\s*error\)/);
  assert.match(source, /key=\{`\$\{projectId\}:\$\{caseId\}`\}/);
  assert.match(source, /Retained retired\/unknown metadata \(read-only\)/);
  assert.match(source, /field\.type === "NUMBER"\s*\? "number"/);
  assert.match(
    source,
    /Procedure\s+version comparison and restore preserve current\s+metadata/,
  );
});
test("project schema changes require current Owner Admin, impact, reason and explicit confirmation", () => {
  const source = file("../components/ProjectCaseFields.tsx");
  assert.match(source, /result\.data\.canConfigure/);
  assert.match(
    source,
    /result\.expectedSchemaHash\s*!==\s*baseline\.expectedSchemaHash/,
  );
  assert.match(source, /Review impact before saving/);
  assert.match(source, /expectedImpactHash:\s*impact!\.expectedImpactHash/);
  assert.match(source, /I reviewed the retained incomplete cases/);
  assert.match(source, /retainedTraceabilityReceipt\(attempt,\s*error\)/);
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
  assert.match(fields, /if \(!baseline && fresh\)/);
  assert.match(fields, /caseId !== undefined\s*\|\|\s*!fresh\.canEdit/);
  assert.match(
    fields,
    /initial\.expectedSchemaHash !== fresh\.expectedSchemaHash/,
  );
  assert.match(fields, /!field\.retired && field\.key === key/);
  assert.match(
    fields,
    /setValues\(\{ \.\.\.fresh\.values, \.\.\.initial\.values \}\)/,
  );
  assert.match(fields, /Start with current fields without preset defaults/);
  assert.match(fields, /!changed && !initialError/);
  const form = file("../components/TestCaseForm.tsx");
  assert.match(
    form,
    /initial=\{mode\s*===\s*"create"\s*&&\s*!testCaseId\s*\?\s*initialCustomFields\s*:\s*undefined\}/,
  );
});
