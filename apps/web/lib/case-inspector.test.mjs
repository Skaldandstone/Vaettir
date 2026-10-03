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
  assert.match(css, /Scenario steps[^}]*min-width:\s*72px;[^}]*white-space:\s*nowrap/s);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.titleBlock\s*\{\s*flex-basis:\s*100%/);
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
  const cases = [{ id: "internal-login", displayId: "atwist-01", title: "Login", archived: false }];
  assert.deepEqual(prerequisitePage(cases, "dependent", [], "ATWIST-01", 0).items, cases);
  assert.equal(cases[0].id, "internal-login");
});

test("procedure comes before on-demand editing and all tab panels remain mounted", () => {
  const detail = source("../components/TestCaseDetailContent.tsx");
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
  assert.match(detail, /<TestCaseVersionHistorySection/);
  assert.match(detail, /Case ID: <code>\{tc.displayId\}<\/code>/);
  assert.match(detail, /\.\.\.tc.given.map/);
  assert.match(detail, /\.\.\.tc.when.map/);
  assert.match(detail, /\.\.\.tc.then.map/);
  assert.match(detail, /tc.steps.map/);
  assert.match(detail, /Prerequisites do not replace scenario/);
  assert.match(detail, /View case history/);
  assert.match(detail, /View saved procedure/);
  assert.match(detail, /Not recorded in this version/);
  assert.match(detail, /Background \/ setup context/);
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
  assert.match(prerequisites, /does not replace Given, When, Then or any steps/);
  assert.match(prerequisites, /\{item.displayId\}/);
  assert.doesNotMatch(prerequisites, /<select/);
});
