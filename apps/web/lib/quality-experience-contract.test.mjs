import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("experience wizard uses labelled multi-select checklists and retains drafts on conflict", () => {
  const wizard = source("../components/QualityExperienceWizard.tsx");
  assert.match(wizard, /<Modal/);
  assert.match(wizard, /type="checkbox"/);
  assert.match(wizard, /checked=\{selected\}/);
  assert.match(wizard, /onChange=\{\(\) => select\(screen.field!, id\)\}/);
  assert.match(wizard, /<label\s+key=\{id\}/);
  assert.match(wizard, /GAME_PLATFORM_GROUPS.map/);
  assert.match(wizard, /expectedProfileHash: baselineHash/);
  assert.match(wizard, /Your draft is retained/);
  assert.match(wizard, /Save testing context/);
  assert.match(wizard, /GAME_PLATFORMS/);
  assert.doesNotMatch(
    wizard,
    /aria-pressed|wizard-choice-chip|generateAutomationDraft|repoSource/,
  );
});
test("manual runs open reviewed configuration and render frozen evidence", () => {
  const cases = source("../app/projects/[projectId]/test-cases/page.tsx");
  assert.match(cases, /<RunConfigurationModal/);
  assert.match(
    cases,
    /setRunSelection\(activeSelectedIds\);\s*setRunConfigurationOpen\(true\)/,
  );
  assert.match(
    cases,
    /activeSelectedIds = selectedCases\s*\.filter\(\(item\) => !item.archived\)\s*\.map\(\(item\) => item.id\)/,
  );
  assert.match(cases, /testCaseIds: runSelection/);
  assert.match(cases, /caseCount=\{runSelection.length\}/);
  const execution = source(
    "../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx",
  );
  assert.match(execution, /data.executionContext.configuration/);
  assert.match(
    execution,
    /Later profile or case edits do not rewrite this run/,
  );
  assert.match(
    execution,
    /Legacy run: no saved profile\/configuration snapshot/,
  );
  assert.match(execution, /Frozen plan definition/);
  assert.match(execution, /data.executionContext.plan.templateHash/);
  assert.match(execution, /link opens the current plan/);
  assert.match(execution, /repeating it creates a separate run/);
});
test("automation uses linked framework family and never blindly defaults to Maestro", () => {
  const detail = source("../components/TestCaseDetailContent.tsx");
  assert.match(detail, /automationTargetForFramework\(sourceFramework\)/);
  assert.match(detail, /tc.source\?\.frameworkFamily/);
  assert.match(detail, /suggested\?\.value \?\? ""/);
  assert.match(detail, /Choose a framework/);
  assert.match(detail, /if \(!framework\) return/);
  assert.doesNotMatch(detail, /useState<AutomationFramework>\("MAESTRO"\)/);
});
