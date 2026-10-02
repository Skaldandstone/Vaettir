import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const form = readFileSync(
  new URL("../components/TestCaseForm.tsx", import.meta.url),
  "utf8",
);
const edit = readFileSync(
  new URL(
    "../app/projects/[projectId]/test-cases/[id]/edit/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const create = readFileSync(
  new URL(
    "../app/projects/[projectId]/test-cases/new/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("draft owns original CAS baseline despite refetched initial props", () => {
  assert.match(form, /const \[baseline\] = useState\(initial\)/);
  for (const field of ["SuitePath", "Priority", "StepRevision"]) {
    assert.match(form, new RegExp(`expected${field}:\\s*baseline\\?\\.`));
    assert.doesNotMatch(form, new RegExp(`expected${field}:\\s*initial\\?\\.`));
  }
});
test("editing session is keyed by project and case and verifies case identity before opening", () => {
  assert.match(edit, /key=\{`\$\{params.projectId\}:\$\{params.id\}`\}/);
  assert.match(
    edit,
    /!tc\s*&&\s*loaded\s*&&\s*canEdit\s*&&\s*!tcQuery.error/,
  );
  assert.match(edit, /tcQuery.data\?\.id === params.id/);
  assert.match(edit, /if \(!tc && pageError\)/);
  assert.match(edit, /locked=\{locked\}/);
  assert.match(edit, /Your unsaved draft is retained/);
});
test("create draft stays mounted after permission refresh failure, but cannot write", () => {
  assert.match(create, /key=\{projectId\}/);
  assert.match(create, /if \(!opened && accessError\)/);
  assert.match(create, /const locked = !loaded \|\| !canEdit/);
  assert.match(create, /locked=\{locked\}/);
  assert.match(create, /retryAccess/);
});
test("native fieldset and handler guards prevent revoked-access writes and save during upload", () => {
  assert.match(
    form,
    /<fieldset\s+disabled=\{locked \|\| saving \|\| uploadingStepKey !== null\}/,
  );
  assert.match(
    form,
    /async function submit\(\) \{\s*if \(locked \|\| saving \|\| uploadingStepKey !== null \|\| !value.title.trim\(\)\)/,
  );
  assert.match(
    form,
    /async function uploadStepMedia[\s\S]*?if \(locked \|\| saving \|\| uploadingStepKey !== null\) return/,
  );
  assert.match(form, /role="alert"[^>]*>\{error\}/);
});
