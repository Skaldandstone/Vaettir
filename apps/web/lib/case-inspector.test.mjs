import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INSPECTOR_SECTIONS,
  inspectorLabel,
  inspectorSectionForKey,
  prerequisitePage,
} from "./case-inspector.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("inspector reserves close-button space and keeps scenario phases legible on mobile", () => {
  const css = source("../components/CaseInspector.module.css");
  assert.match(css, /\.header\s*\{[^}]*padding-right:\s*44px/s);
  assert.match(
    css,
    /Scenario steps[^}]*min-width:\s*72px;[^}]*white-space:\s*nowrap/s,
  );
  assert.match(
    css,
    /@media \(max-width: 480px\)[\s\S]*\.titleBlock\s*\{\s*flex-basis:\s*100%/,
  );
});

test("inspector labels preserve acronyms and make domain values readable without changing values", () => {
  assert.equal(
    inspectorLabel("AI_REVERSE_ENGINEERED"),
    "AI reverse-engineered",
  );
  assert.equal(inspectorLabel("HIL"), "Hardware-in-the-loop");
  assert.equal(inspectorLabel("FOOD_SAFETY"), "Food safety");
  assert.equal(inspectorLabel("API"), "API");
  assert.equal(inspectorLabel("PENDING_REVIEW"), "Pending review");
  assert.equal(inspectorLabel("software"), "Software");
  assert.equal(inspectorLabel("FUNCTIONAL"), "Functional");
  assert.equal(inspectorLabel("MEDIUM"), "Medium");
  assert.equal(inspectorLabel("IMPORTED"), "Imported");
});

test("four-section tab keyboard navigation wraps and supports endpoints", () => {
  assert.deepEqual(INSPECTOR_SECTIONS, [
    "Procedure",
    "Intelligence",
    "Evidence",
    "History",
  ]);
  assert.equal(inspectorSectionForKey("Procedure", "ArrowLeft"), "History");
  assert.equal(inspectorSectionForKey("History", "ArrowRight"), "Procedure");
  assert.equal(inspectorSectionForKey("History", "Home"), "Procedure");
  assert.equal(inspectorSectionForKey("Procedure", "End"), "History");
  assert.equal(inspectorSectionForKey("Procedure", "Tab"), null);
});

test("on-demand prerequisite picker can reach every same-title case in an 851-case inventory", () => {
  const inventory = Array.from({ length: 851 }, (_, index) => ({
    id: `case-${index}`,
    title: "Same title",
    archived: false,
  }));
  const ids = [];
  for (let page = 0; page < 43; page++) {
    const result = prerequisitePage(
      inventory,
      "outside",
      [],
      "Same title",
      page,
    );
    assert.equal(result.total, 851);
    assert.equal(result.pageCount, 43);
    assert.ok(result.items.length <= 20);
    ids.push(...result.items.map((item) => item.id));
  }
  assert.equal(new Set(ids).size, 851);
  assert.deepEqual(
    ids,
    inventory.map((item) => item.id),
  );
});

test("prerequisite search excludes self, archived and selected cases without mutating saved selections", () => {
  const selected = ["selected", "unavailable"];
  const inventory = [
    { id: "self", title: "Login", archived: false },
    { id: "selected", title: "Login", archived: false },
    { id: "archive", title: "Login", archived: true },
    { id: "case-target", title: "Login required", archived: false },
  ];
  assert.deepEqual(
    prerequisitePage(inventory, "self", selected, " Login ", 99).items.map(
      (item) => item.id,
    ),
    ["case-target"],
  );
  assert.deepEqual(
    prerequisitePage(inventory, "self", selected, "case-target", 0).items.map(
      (item) => item.id,
    ),
    ["case-target"],
  );
  assert.equal(
    prerequisitePage(inventory, "self", selected, "not present", 5).page,
    0,
  );
  assert.deepEqual(selected, ["selected", "unavailable"]);
});

test("prerequisites are found by project case key, while retaining internal relation identity", () => {
  const cases = [
    {
      id: "internal-login",
      displayId: "atwist-01",
      title: "Login",
      archived: false,
    },
  ];
  assert.deepEqual(
    prerequisitePage(cases, "dependent", [], "ATWIST-01", 0).items,
    cases,
  );
  assert.equal(cases[0].id, "internal-login");
});

test("procedure comes before on-demand editing and all tab panels remain mounted", () => {
  const detail = source("../components/TestCaseDetailContent.tsx");
  const versions = source("../components/TestCaseVersionReview.tsx");
  assert.ok(
    detail.indexOf('aria-label="Scenario steps"') <
      detail.indexOf("<TestCasePrerequisites"),
  );
  for (const section of INSPECTOR_SECTIONS) {
    assert.ok(detail.includes(`hidden={section !== "${section}"}`));
    assert.ok(detail.includes(`panel-${section}`));
  }
  assert.match(detail, /role="tablist"/);
  assert.match(detail, /inspectorSectionForKey\(name, event.key\)/);
  assert.match(detail, /onSuiteSelect\(tc.suitePath\)/);
  assert.match(detail, /Edit case/);
  assert.match(detail, /Show full title/);
  assert.match(detail, /Open saved automation draft/);
  assert.match(detail, /Review case/);
  assert.match(detail, /if \(!tc && tcQuery.error\)/);
  assert.match(detail, /<TestCaseInspector key=\{props.id\}/);
  assert.doesNotMatch(detail, /<TestCasePrerequisites\s+key=\{tc.id\}/);
  assert.doesNotMatch(detail, /<DatasetSection\s+key=\{tc.id\}/);
  assert.doesNotMatch(detail, /if \(error \?\? tcQuery.error\)/);
  assert.match(
    detail,
    /<TestDesignReview\s+testCaseId=\{testCaseId\}\s+readOnly=\{readOnly\}/,
  );
  assert.match(detail, /<AutomationDraftSection/);
  assert.match(
    detail,
    /<TestCaseVersionReview[\s\S]*?key=\{tc.id\}[\s\S]*?projectId=\{projectId\}[\s\S]*?testCaseId=\{tc.id\}[\s\S]*?active=\{section === "History"\}[\s\S]*?readOnly=\{readOnly\}/,
  );
  assert.match(detail, /Case ID: <code>\{tc.displayId\}<\/code>/);
  assert.match(detail, /\.\.\.tc.given.map/);
  assert.match(detail, /\.\.\.tc.when.map/);
  assert.match(detail, /\.\.\.tc.then.map/);
  assert.match(detail, /tc.steps.map/);
  assert.match(detail, /Prerequisites do not replace scenario/);
  assert.match(detail, /View case history/);
  assert.match(versions, /Compare current case with v/);
  assert.match(
    versions,
    /<ComparisonValue\s+value=\{field.current\}\s+field=\{field.key\}/,
  );
  assert.match(
    versions,
    /<ComparisonValue\s+value=\{field.saved\}\s+field=\{field.key\}/,
  );
  assert.match(versions, /Not recorded/);
  assert.match(versions, /Expected action \/ data/);
  assert.match(versions, /Expected result/);
  assert.match(versions, /Expected response/);
  assert.match(versions, /Recorded image\/video references/);
  assert.match(detail, /Background \/ setup context/);
});

test("case version comparison retains reviewed requests and gates selected-field restores", () => {
  const versions = source("../components/TestCaseVersionReview.tsx");
  assert.match(versions, /caseVersionReview.list.useQuery/);
  assert.match(versions, /enabled: active/);
  assert.match(
    versions,
    /enabled:\s*open &&\s*version !== null &&\s*fromVersion === null &&\s*!baseline &&\s*!pending/,
  );
  assert.match(versions, /f.changed && f.restorable/);
  assert.match(versions, /expectedCaseRevision: baseline.expectedCaseRevision/);
  assert.match(
    versions,
    /expectedVersionRevision: baseline.expectedVersionRevision/,
  );
  assert.match(versions, /requestId: crypto.randomUUID\(\)/);
  assert.match(versions, /const attempt = pending \?\?/);
  assert.match(versions, /retainedTraceabilityReceipt\(attempt, error\)/);
  assert.match(versions, /Retry reviewed restore/);
  assert.match(
    versions,
    /!confirmed \|\| !reason.trim\(\) \|\| !fields.length/,
  );
  assert.match(versions, /readOnly \|\| !baseline.canRestore/);
  assert.match(versions, /restorationNotice/);
  assert.match(versions, /current profile/);
  assert.match(versions, /v.restoration.reason/);
  assert.match(versions, /No credits are used/);
  assert.match(versions, /size="wide"/);
});

test("version restore review rejects stale cached refresh failures and paused queries", () => {
  const versions = source("../components/TestCaseVersionReview.tsx");
  assert.match(versions, /currentCaseVersionPreview\(compare, version\)/);
  assert.match(versions, /staleTime: 0/);
  assert.match(
    versions,
    /if \(\s*open &&\s*!baseline &&\s*!pending &&\s*fromVersion === null &&\s*freshPreview\s*\)/,
  );
  assert.match(versions, /setBaseline\(freshPreview\)/);
  assert.match(versions, /compare.isPaused && !baseline/);
  assert.match(versions, /Waiting for a connection to refresh the comparison/);
  assert.match(versions, /compare.error && !baseline/);
  assert.match(versions, /Retry comparison/);
  assert.doesNotMatch(versions, /setBaseline\(compare.data\)/);
});

test("historical version pairs stay read-only and require a separate current-case restore baseline", () => {
  const versions = source("../components/TestCaseVersionReview.tsx");
  assert.match(versions, /caseVersionReview.compareHistorical.useQuery/);
  assert.match(versions, /fromVersionNumber: fromVersion \?\? 1/);
  assert.match(versions, /toVersionNumber: version \?\? 1/);
  assert.match(
    versions,
    /enabled: open && fromVersion !== null && version !== null && !pending/,
  );
  assert.match(versions, /Choose comparison versions/);
  assert.match(versions, /<select[\s\S]*?value=\{fromVersion \?\? "current"\}/);
  assert.match(versions, /<select\s+value=\{version\}/);
  assert.match(versions, /Browse older versions/);
  assert.match(versions, /Browse newer versions/);
  assert.match(versions, /Selected\s+versions stay available/);
  assert.match(versions, /Historical comparison only/);
  assert.match(
    versions,
    /<details style=\{\{ margin: "8px 0" \}\}>\s*<summary>Snapshot limitations<\/summary>\s*<ul>\s*\{historical.data.warnings.map/,
  );
  assert.match(
    versions,
    /Neither side is the current case or\s+a write baseline/,
  );
  assert.match(
    versions,
    /<ComparisonValue\s+value=\{field.from\}\s+field=\{field.key\}/,
  );
  assert.match(
    versions,
    /<ComparisonValue\s+value=\{field.to\}\s+field=\{field.key\}/,
  );
  assert.match(versions, /historical.data.from.versionNumber === fromVersion/);
  assert.match(versions, /historical.data.to.versionNumber === version/);
  assert.match(versions, /Retry saved comparison/);
  assert.match(versions, /Compare v\$\{version\} with current/);
  assert.match(versions, /Review restoring v\$\{version\} to current/);
  assert.match(
    versions,
    /onClick=\{\(\) => changeComparison\(version!, null\)\}/,
  );
  assert.match(
    versions,
    /function changeComparison[\s\S]*?if \(pending \|\| restore.isPending\) return;[\s\S]*?setBaseline\(null\)[\s\S]*?setFields\(\[\]\)[\s\S]*?setReason\(""\)[\s\S]*?setConfirmed\(false\)/,
  );
  assert.match(
    versions,
    /function applyRestore[\s\S]*?fromVersion !== null[\s\S]*?baseline.versionNumber !== version/,
  );
  const historicalBlock = versions.slice(
    versions.indexOf("Historical comparison only"),
    versions.indexOf("{fromVersion === null && baseline &&"),
  );
  assert.doesNotMatch(
    historicalBlock,
    /type="checkbox"|expectedCaseRevision|mutateAsync|Reason for this restore/,
  );
});

test("viewer can browse paid design recommendations without evidence intake, charge or apply controls", () => {
  const design = source("../components/TestDesignReview.tsx");
  assert.match(design, /evidence: readOnly \? undefined : evidence/);
  assert.match(design, /View saved design reviews/);
  assert.match(design, /!readOnly && step === "evidence"/);
  assert.match(design, /!readOnly && step === "approve"/);
  assert.match(design, /readOnly \|\| step === "review"/);
  assert.match(
    design,
    /!readOnly && [\s\S]*Use recommendations in draft setup/,
  );
  assert.match(design, /!readOnly && [\s\S]*Back to evidence/);
});

test("prerequisite edits retain expected baseline, unavailable selections and explicit cancel/save", () => {
  const prerequisites = source("../components/TestCasePrerequisites.tsx");
  assert.match(prerequisites, /enabled: editing \|\| baseline.length > 0/);
  assert.match(prerequisites, /type="search"/);
  assert.match(prerequisites, /hidden=\{!editing\}/);
  assert.match(prerequisites, /canEdit && editing &&/);
  assert.match(prerequisites, /expectedPrerequisiteIds:/);
  assert.match(prerequisites, /draft.baseline/);
  assert.match(prerequisites, /Your draft is retained/);
  assert.match(prerequisites, /Unavailable case/);
  assert.match(prerequisites, /Cancel changes/);
  assert.match(prerequisites, /Save prerequisites/);
  assert.match(prerequisites, /Execution prerequisites/);
  assert.match(
    prerequisites,
    /does not replace Given, When, Then or any steps/,
  );
  assert.match(prerequisites, /\{item.displayId\}/);
  assert.doesNotMatch(prerequisites, /<select/);
});
