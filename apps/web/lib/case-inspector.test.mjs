import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  INSPECTOR_SECTIONS,
  inspectorLabel,
  inspectorSectionForKey,
  prerequisitePage,
} from "./case-inspector.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// Compile the exact current inspector JSX metadata fragment, not a copied
// renderer or mock site. No hooks, network, browser geometry or auth are modeled.
function suiteMetadata(suitePath, onSuiteSelect) {
  const text = source("../components/TestCaseDetailContent.tsx");
  const file = ts.createSourceFile("TestCaseDetailContent.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "span" &&
      node.children.some(child => ts.isJsxElement(child) && child.openingElement.tagName.getText(file) === "strong" && child.getText(file) === "<strong>Suite:</strong>")) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(matches.length, 1, "Exactly one actual suite metadata fragment must be inspected");
  const compiled = ts.transpileModule(`exports.renderSuite = (tc, onSuiteSelect, projectId) => (${matches[0].getText(file)});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports = {};
  new Function("exports", "React", compiled)(exports, React);
  const tc = Object.freeze({ suitePath });
  const element = exports.renderSuite(tc, onSuiteSelect, "synthetic-project");
  return { html: renderToStaticMarkup(element), element, tc };
}

// Render only the exact current procedure table and its actual cell styles.
// This checks React output/raw text, not browser geometry, native reads or auth.
function procedureTable(kind, tc, { showTechnicalBehavior = true, showExpectedResponse = true, attachments = [] } = {}) {
  const text = source("../components/TestCaseDetailContent.tsx");
  const file = ts.createSourceFile("TestCaseDetailContent.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tables = [], declarations = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "table" &&
      node.getText(file).includes(kind === "scenario" ? "...tc.given.map" : "tc.steps.map")) tables.push(node);
    if (ts.isVariableDeclaration(node) && ["cellStyle", "procedureTextCellStyle"].includes(node.name.getText(file))) declarations.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(tables.length, 1, "Render exactly one actual procedure table");
  assert.equal(declarations.length, 2, "Use both actual source cell-style declarations");
  const compiled = ts.transpileModule(`${declarations.map(node => `const ${node.getText(file)};`).join("\n")}
    exports.renderTable = (tc, showTechnicalBehavior, showExpectedResponse, stepAttachments, viewStepMedia) => (${tables[0].getText(file)});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports = {}, mediaRequests = [];
  new Function("exports", "React", compiled)(exports, React);
  const element = exports.renderTable(tc, showTechnicalBehavior, showExpectedResponse, { data: attachments, isLoading: false }, id => mediaRequests.push(id));
  return { element, html: renderToStaticMarkup(element), mediaRequests };
}

function childrenOfType(element, type) {
  return React.Children.toArray(element.props.children).filter(child => React.isValidElement(child) && child.type === type);
}

function tableRows(table) {
  return childrenOfType(childrenOfType(table, "tbody")[0], "tr");
}

function assertProcedureProseCell(cell) {
  assert.equal(cell.props.style.whiteSpace, "pre-wrap");
  assert.equal(cell.props.style.overflowWrap, "anywhere");
  assert.equal(cell.props.style.border, "1px solid var(--line)");
  assert.equal(cell.props.style.padding, "6px 10px");
  assert.equal(cell.props.style.textAlign, "left");
}

test("actual structured procedure pairs complete multiline prose with unchanged order and media references", () => {
  const tc = {
    stepFieldLabels: { action: "Tester action", expectedActionOrData: "Technical behavior", expectedResult: "Visible result", expectedResponse: "API response" },
    steps: [{
      order: 4, action: '  Click this button\n\tKeep <script>alert("literal")</script> text  ',
      expectedActionOrData: "OnclickFunction triggers API GET\napiURL: /episodes?next=1&mode=2\n  keep indentation",
      expectedResult: "First visible result\n\nSecond paragraph  retained",
      expectedResponse: '{\n  "ok": true,\n  "literal": "<img src=x onerror=alert(1)>"\n}',
      mediaAttachmentIds: ["original-image-reference", "unavailable-reference"],
    }, { order: 0, action: "Second original row", expectedActionOrData: null, expectedResult: null, expectedResponse: null, mediaAttachmentIds: [] },
    { order: 2, action: "Third original row", expectedActionOrData: "", expectedResult: "", expectedResponse: "", mediaAttachmentIds: [] }],
  };
  const original = structuredClone(tc);
  const rendered = procedureTable("structured", tc, { attachments: [{ id: "original-image-reference", contentType: "image/png", fileName: 'Original <image> "name".png' }] });
  const rows = tableRows(rendered.element);
  assert.deepEqual(rows.map(row => childrenOfType(row, "td")[0].props.children), [5, 1, 3]);
  const cells = childrenOfType(rows[0], "td");
  assert.equal(cells.length, 5);
  assert.equal(cells[0].props.style.whiteSpace, undefined, "Number layout is not changed to prose style");
  for (const cell of cells.slice(1)) assertProcedureProseCell(cell);
  assert.equal(childrenOfType(cells[1], "div")[0].props.children, tc.steps[0].action);
  assert.deepEqual(cells.slice(2).map(cell => cell.props.children), [tc.steps[0].expectedActionOrData, tc.steps[0].expectedResult, tc.steps[0].expectedResponse]);
  const media = childrenOfType(childrenOfType(cells[1], "ul")[0], "li");
  assert.deepEqual(media.map(item => item.key), [".$original-image-reference", ".$unavailable-reference"]);
  const mediaButton = childrenOfType(media[0], "button")[0];
  mediaButton.props.onClick();
  assert.deepEqual(rendered.mediaRequests, ["original-image-reference"]);
  assert.equal(childrenOfType(media[1], "span")[0].props.children, "Media unavailable (unavaila)");
  assert.match(rendered.html, /white-space:pre-wrap;overflow-wrap:anywhere/);
  assert.match(rendered.html, /OnclickFunction triggers API GET\napiURL: \/episodes\?next=1&amp;mode=2\n {2}keep indentation/);
  assert.match(rendered.html, /&lt;script&gt;alert\(&quot;literal&quot;\)&lt;\/script&gt;/);
  assert.match(rendered.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(rendered.html, /<script\b|<img\b/);
  const headers = childrenOfType(childrenOfType(childrenOfType(rendered.element, "thead")[0], "tr")[0], "th");
  assert.deepEqual(headers.map(header => header.props.children), ["#", "Tester action", "Technical behavior", "Visible result", "API response"]);
  for (const header of headers) assert.equal(header.props.style.whiteSpace, undefined, "Headers retain the original style");
  const nullCells = childrenOfType(rows[1], "td"), emptyCells = childrenOfType(rows[2], "td");
  assert.deepEqual(nullCells.slice(2).map(cell => cell.props.children), ["Not supplied", "Not supplied", "Not supplied"]);
  assert.equal(childrenOfType(emptyCells[2], "em")[0].props.children, "Empty text");
  assert.equal(childrenOfType(emptyCells[3], "em")[0].props.children, "Empty text", "Explicit empty result is labeled distinctly, not displayed as NULL");
  assert.equal(childrenOfType(emptyCells[4], "em")[0].props.children, "Empty text");
  assert.deepEqual(tc, original, "No prose, labels, ordering or media identity is rewritten");
});

test("actual structured procedure preserves optional descriptor visibility without changing its visible prose cells", () => {
  const tc = { stepFieldLabels: { action: "Action", expectedActionOrData: "Technical", expectedResult: "Result", expectedResponse: "Response" }, steps: [
    { order: 0, action: "Click\n  button", expectedActionOrData: "Hidden technical value", expectedResult: "Visible\n  result", expectedResponse: "Hidden response value", mediaAttachmentIds: [] },
  ] };
  const original = structuredClone(tc);
  const rendered = procedureTable("structured", tc, { showTechnicalBehavior: false, showExpectedResponse: false });
  const cells = childrenOfType(tableRows(rendered.element)[0], "td");
  assert.equal(cells.length, 3);
  assertProcedureProseCell(cells[1]);
  assertProcedureProseCell(cells[2]);
  assert.equal(childrenOfType(cells[1], "div")[0].props.children, tc.steps[0].action);
  assert.equal(cells[2].props.children, tc.steps[0].expectedResult);
  assert.doesNotMatch(rendered.html, /Hidden technical value|Hidden response value/);
  assert.deepEqual(tc, original);
});

test("actual scenario procedure preserves multiline conditions and outcomes without changing phase order", () => {
  const tc = { given: ["  Given condition\n\tkept indentation", ""], when: ["When action\n<svg onload=alert(1)>"], then: ["Then outcome\n\n  second paragraph"] };
  const original = structuredClone(tc);
  const rendered = procedureTable("scenario", tc);
  const rows = tableRows(rendered.element);
  assert.deepEqual(rows.map(row => childrenOfType(row, "td")[0].props.children), [1, 2, 3, 4]);
  assert.deepEqual(rows.map(row => childrenOfType(row, "td")[1].props.children), ["Given", "Given", "When", "Then"]);
  assert.deepEqual(rows.map(row => childrenOfType(row, "td").slice(2).map(cell => cell.props.children)), [
    [tc.given[0], "—"], ["", "—"], [tc.when[0], "—"], ["—", tc.then[0]],
  ]);
  for (const row of rows) {
    const cells = childrenOfType(row, "td");
    assert.equal(cells[0].props.style.whiteSpace, undefined);
    assert.equal(cells[1].props.style.whiteSpace, undefined, "Existing single-line phase styling stays unchanged");
    for (const cell of cells.slice(2)) assertProcedureProseCell(cell);
  }
  assert.match(rendered.html, /Given condition\n\tkept indentation/);
  assert.match(rendered.html, /Then outcome\n\n {2}second paragraph/);
  assert.match(rendered.html, /&lt;svg onload=alert\(1\)&gt;/);
  assert.doesNotMatch(rendered.html, /<svg\b/);
  assert.deepEqual(tc, original);
});

test("actual suite metadata distinguishes native NULL from retained empty path without an unsupported route", () => {
  const unassigned = suiteMetadata(null), empty = suiteMetadata("");
  assert.equal(unassigned.html, "<span><strong>Suite:</strong> Unassigned</span>");
  assert.doesNotMatch(unassigned.html, /<a\b|Saved empty suite path/);
  assert.match(empty.html, /Saved empty suite path \(repository navigation unavailable\)/);
  assert.match(empty.html, /title="Saved suite path &quot;&quot;"/);
  assert.doesNotMatch(empty.html, /<a\b|href=|Unassigned/);
  assert.equal(empty.tc.suitePath, "");
});

test("actual suite metadata discloses exact whitespace and keeps ordinary literal routing and callback", () => {
  for (const path of ["  ", "\n\t ", "Login/basic", "Unassigned", ' x "quoted"\nretained ', "A/🎮/Ö"]) {
    const selected = [], rendered = suiteMetadata(path, value => selected.push(value));
    const anchor = React.Children.toArray(rendered.element.props.children).find(child => React.isValidElement(child) && child.type === "a");
    assert.ok(anchor, "Every nonempty stored path retains its ordinary suite link");
    assert.equal(anchor.props.href, `/projects/synthetic-project/test-cases?suite=${encodeURIComponent(path)}`);
    assert.equal(anchor.props.style.whiteSpace, "pre-wrap");
    assert.equal(anchor.props.title, `Saved suite path ${JSON.stringify(path)}`);
    assert.equal(anchor.props["aria-label"], `Open saved suite path ${JSON.stringify(path)}`);
    assert.equal(anchor.props.children, path.trim().length === 0 ? JSON.stringify(path) : path);
    assert.equal(rendered.tc.suitePath, path);
    let prevented = false;
    anchor.props.onClick({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(selected, [path]);
    assert.doesNotMatch(rendered.html, /Saved empty suite path \(repository navigation unavailable\)/);
    const standalone = suiteMetadata(path);
    const standaloneAnchor = React.Children.toArray(standalone.element.props.children).find(child => React.isValidElement(child) && child.type === "a");
    standaloneAnchor.props.onClick({ preventDefault() { assert.fail("Without the drawer callback, normal route navigation must remain unchanged"); } });
  }
});

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

test("five-section tab keyboard navigation includes comments and preserves endpoints", () => {
  assert.deepEqual(INSPECTOR_SECTIONS, [
    "Procedure",
    "Intelligence",
    "Evidence",
    "Comments",
    "History",
  ]);
  assert.equal(inspectorSectionForKey("Procedure", "ArrowLeft"), "History");
  assert.equal(inspectorSectionForKey("History", "ArrowRight"), "Procedure");
  assert.equal(inspectorSectionForKey("History", "Home"), "Procedure");
  assert.equal(inspectorSectionForKey("Procedure", "End"), "History");
  assert.equal(inspectorSectionForKey("Procedure", "Tab"), null);
  assert.equal(inspectorSectionForKey("Evidence", "ArrowRight"), "Comments");
  assert.equal(inspectorSectionForKey("Comments", "ArrowRight"), "History");
  assert.equal(inspectorSectionForKey("Comments", "ArrowLeft"), "Evidence");
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
  const controller = source("./use-case-version-restore.ts");
  const draft = source("./case-version-draft.ts");
  assert.match(versions, /caseVersionReview.list.useQuery/);
  assert.match(versions, /enabled: active/);
  assert.match(
    versions,
    /enabled:\s*active &&\s*reads.readable &&\s*compareCycle.ready &&\s*open &&\s*version !== null &&\s*fromVersion === null/,
  );
  assert.match(controller, /field.changed && field.restorable/);
  assert.match(controller, /expectedCaseRevision: captured.baseline.expectedCaseRevision/);
  assert.match(
    controller,
    /expectedVersionRevision: captured.baseline.expectedVersionRevision/,
  );
  assert.match(controller, /requestId: crypto.randomUUID\(\)/);
  assert.match(controller, /let retained = held/);
  assert.match(controller, /retainedTraceabilityReceipt\(/);
  assert.match(controller, /mutation.mutateAsync\(sent.input\)/);
  assert.match(controller, /assertVersionRestoreAck\(result, sent\)/);
  assert.match(draft, /expectedNativeActorId: origin.nativeActorId/);
  assert.match(versions, /caseVersionReview.restoreReviewed.useMutation/);
  assert.match(versions, /Retry reviewed restore/);
  assert.match(
    controller,
    /!captured.confirmed[\s\S]*?!captured.fields.length[\s\S]*?!captured.reason.trim\(\)/,
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
  const controller = source("./use-case-version-restore.ts"), reader = source("./case-version-draft.ts");
  assert.match(versions, /currentCaseVersionPreview\(compare, version\)/);
  assert.match(versions, /staleTime: 0/);
  assert.match(
    controller,
    /!preview[\s\S]*?fromVersion !== null[\s\S]*?draftRef.current[\s\S]*?pendingRef.current/,
  );
  assert.match(versions, /preview: freshPreview/);
  assert.match(controller, /baseline: freezeVersionReview\(preview\)/);
  assert.match(reader, /query.isFetchedAfterMount/);
  assert.match(reader, /!query.error[\s\S]*?!query.isFetching[\s\S]*?!query.isPaused/);
  assert.match(reader, /context\?\.readRequestId === readRequestId/);
  assert.match(reader, /sameVersionReader\(context.readScope, origin\)/);
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
    /enabled:\s*active &&\s*reads.readable &&\s*historicalCycle.ready &&\s*open &&\s*fromVersion !== null &&\s*version !== null/,
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
    /function changeComparison[\s\S]*?if \(!editor.clearComparison\(\)\) return;[\s\S]*?setVersion\(nextVersion\)[\s\S]*?setFromVersion\(nextFrom\)/,
  );
  const controller = source("./use-case-version-restore.ts");
  assert.match(
    controller,
    /async function commit[\s\S]*?fromVersion !== null[\s\S]*?captured.baseline.versionNumber !== version/,
  );
  assert.match(controller, /function clearComparison[\s\S]*?busyRef.current[\s\S]*?pendingRef.current[\s\S]*?draftRef.current = null[\s\S]*?setDraft\(null\)/);
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

test("prerequisite edits retain expected native baseline, unavailable selections and explicit close/discard/save", () => {
  const prerequisites = source("../components/TestCasePrerequisites.tsx");
  const detail = source("../components/TestCaseDetailContent.tsx");
  assert.match(detail, /<TestCasePrerequisites[\s\S]*?active=\{section === "Procedure"\}/);
  const controller = source("./use-case-prerequisites.ts"), draft = source("./case-prerequisite-draft.ts");
  assert.match(controller, /testCaseStructure.prerequisiteAccess.useQuery/);
  assert.match(controller, /testCaseStructure.prerequisitePage.useQuery/);
  assert.match(controller, /testCaseStructure.reviewedSetPrerequisites.useMutation/);
  assert.match(controller, /readRequestId: cycle.id/);
  assert.match(controller, /readRequestId === pageCycle.id/);
  assert.match(controller, /samePrerequisiteReader/);
  assert.doesNotMatch(controller, /testCases.list|caseFields.get|setPrerequisites.useMutation/);
  assert.match(prerequisites, /type="search"/);
  assert.match(prerequisites, /hidden=\{!control.open\}/);
  assert.match(prerequisites, /control.open && editable &&/);
  assert.match(draft, /expectedPrerequisiteIds: Object.freeze\(\[\.\.\.draft.baseline\]\)/);
  assert.match(draft, /expectedActorId: draft.origin.actorId/);
  assert.match(controller, /existing\?\.baseline \?\? Object.freeze/);
  assert.match(prerequisites, /Your draft remains retained/);
  assert.match(prerequisites, /Unavailable case/);
  assert.match(prerequisites, /Close and keep draft/);
  assert.match(prerequisites, /Discard retained draft/);
  assert.match(prerequisites, /Review and save prerequisites/);
  assert.match(prerequisites, /Retry same prerequisite request/);
  assert.match(prerequisites, /New links must be currently approved active cases/);
  assert.match(prerequisites, /Maximum 50 direct prerequisites/);
  assert.match(prerequisites, /saved.offset \/ 20/);
  assert.match(prerequisites, /Execution prerequisites/);
  assert.match(
    prerequisites,
    /never replaces Given, When, Then or procedure steps/,
  );
  assert.match(prerequisites, /\{item.displayId\}/);
  assert.match(prerequisites, /aria-label="Sort prerequisite cases"/);
  assert.doesNotMatch(
    prerequisites,
    /Choose a case|<option[^>]*value=\{item.id\}/,
  );
});

test("prerequisite sorting uses natural stable case IDs and titles before pagination without changing inventory", () => {
  const cases = [
    { id: "b", displayId: "APP-10", title: "Alpha", archived: false },
    { id: "a", displayId: "APP-2", title: "Zulu", archived: false },
    { id: "c", displayId: "APP-3", title: "Alpha", archived: false },
  ];
  assert.deepEqual(
    prerequisitePage(cases, "self", [], "", 0, "case-id").items.map(
      (item) => item.id,
    ),
    ["a", "c", "b"],
  );
  assert.deepEqual(
    prerequisitePage(cases, "self", [], "", 0, "title").items.map(
      (item) => item.id,
    ),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    cases.map((item) => item.id),
    ["b", "a", "c"],
  );
  const inventory = Array.from({ length: 41 }, (_, index) => ({
    id: `case-${index}`,
    displayId: `APP-${41 - index}`,
    title: "Same",
    archived: false,
  }));
  assert.equal(
    prerequisitePage(inventory, "self", [], "", 1, "case-id").items[0]
      .displayId,
    "APP-21",
  );
});
