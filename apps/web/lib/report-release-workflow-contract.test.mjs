// Source-only contracts authored 2026-10-04. NOT EXECUTED tonight.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
const source = (path) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
test("release selectors preserve stored scope and explain current membership instead of historic readiness", () => {
  for (const path of [
    "../components/ReportBuilder.tsx",
    "../components/ReportDefinitionSettingsEditor.tsx",
  ]) {
    const text = source(path);
    assert.match(text, /executionScope\?\.releaseId/);
    assert.match(text, /releases\.map/);
    assert.match(text, /Stored release/);
    assert.match(text, /historical|older runs/);
    assert.match(text, /releasesLimited/);
  }
});
test("frozen portable scope uses captured release label and not native identity fallback", () => {
  const text = source("./frozen-report.ts");
  assert.match(text, /report\.scope\.releaseName/);
  assert.match(text, /portable \? "Selected release" : filters.releaseId/);
  assert.match(text, /releaseNameIsExcerpt/);
});
test("capture freezes resolved plan identities and carries bounded planned cases into denominator", () => {
  const text = source("../../../apps/api/src/routers/reportSnapshots.ts");
  assert.match(text, /resolveReportReleaseScope/);
  assert.match(text, /readReportPlanCaseScope/);
  assert.match(text, /releasePlanIds: releaseScope.planIds/);
  assert.match(text, /planCaseScope.caseIds/);
  assert.match(text, /Unexecuted planned cases remain in the denominator/);
});
