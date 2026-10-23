import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { caseLabel, suiteChoices } from "./case-workbench.ts";
test("workbench labels present human enum names without changing identities", () => {
  assert.equal(caseLabel("PENDING_REVIEW"), "Pending review");
  assert.equal(caseLabel("AI_REVERSE_ENGINEERED"), "AI reverse-engineered");
  assert.equal(caseLabel("E2E"), "End-to-end");
  assert.equal(caseLabel("PARTIALLY_AUTOMATED"), "Partially automated");
});
test("mobile suite chooser retains prefix scopes, source defaults and exact paths", () => {
  assert.deepEqual(
    suiteChoices([
      { suitePath: "Game/Console", sourceFilePath: "ignored/file" },
      { suitePath: null, sourceFilePath: "tests/unit" },
      { suitePath: "Game/PC", sourceFilePath: null },
      { suitePath: null, sourceFilePath: null },
    ]),
    ["Game", "Game/Console", "Game/PC", "tests", "tests/unit"],
  );
});
test("compact workbench preserves scoped reviewed actions and mounted bounded analysis", () => {
  const page = readFileSync(
    new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /PageHeading\s+eyebrow=\{project\?\.name/);
  assert.match(
    page,
    /title=\{reviewFilter === "APPROVED" \? "Test cases" : "Review queue"\}/,
  );
  assert.match(page, /aria-label="Choose suite"/);
  assert.match(page, /aria-label="Active filters"/);
  assert.match(page, /data-label="Risk"/);
  assert.match(page, /styles.table/);
  assert.match(
    page,
    /!loading && \(cases.length > 0 \|\| folderPaths.length > 0\)/,
  );
  assert.match(page, /runCaseActionBatches\(\s*reviewedIds,\s*execute,?\s*\)/);
  assert.match(page, /setReviewAction\(\{\s*kind,\s*ids:/);
  assert.match(page, /bulkDelete\(reviewAction.ids\)/);
  assert.match(page, /if \(readOnly \|\| bulkBusy/);
  assert.match(page, /BulkCaseAnalysis[^>]*selectedIds=\{\[\.\.\.selected\]\}/);
  assert.match(page, /!readOnly && selectedPath === UNASSIGNED/);
  const analysis = readFileSync(
    new URL("../components/BulkCaseAnalysis.tsx", import.meta.url),
    "utf8",
  );
  assert.match(analysis, /DurableCaseAnalysis[^>]*selectedIds=\{selectedIds\}/);
  const durable = readFileSync(
    new URL("../components/DurableCaseAnalysis.tsx", import.meta.url),
    "utf8",
  );
  assert.match(durable, /Maximum approved spend/);
  assert.match(durable, /saved\.balance >= saved\.maximumCredits &&\s+consent/);
  assert.match(durable, /selectedIds\.length > 1000/);
});
