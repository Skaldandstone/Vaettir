// Real local repair helpers/JSX with synthetic event callbacks. No files or
// customer records are uploaded or modified by these fixtures.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";
import { remainingNonCaseRows } from "./reassign-import-column";
import { importReviewRows, typeReviewLabel } from "./import-type-review";

const source = readFileSync(new URL("../components/MigrationWizard.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("Migration.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["rowRecord", "reconcileRowOverrides", "splitEditedLines", "RowRepairEditor", "NonCaseRowsReview", "RowMappingReview", "ImportRecommendations"];
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""));
if (declarations.length !== names.length) throw Error("Actual import repair declarations missing");
const code = ts.transpileModule(declarations.map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const actual = new Function("React", "remainingNonCaseRows", "typeReviewLabel", code + "\nreturn { rowRecord, reconcileRowOverrides, splitEditedLines, RowRepairEditor, NonCaseRowsReview, RowMappingReview, ImportRecommendations };")(React, remainingNonCaseRows, typeReviewLabel);
const row = { rowNumber: 2, title: "", externalId: "original-ID", tags: ["Not a case name"], given: [" Setup\n  kept "], when: ["1. Reinstall.\n\n  2. Check a|b."], then: [" Expected\nvalue "], priority: "MEDIUM", testType: "FUNCTIONAL", automationStatus: "MANUAL" };
function elements(root: React.ReactNode): React.ReactElement<{ children?: React.ReactNode; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void }>[] {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!React.isValidElement<{ children?: React.ReactNode }>(root)) return [];
  return [root, ...elements(root.props.children)];
}
it("never substitutes tags or external IDs for a missing case title", () => {
  const before = JSON.stringify(row), result = actual.rowRecord([row]);
  expect(result[2].title).toBe("");
  expect(result[2].tags).toEqual(["Not a case name"]);
  expect(result[2].externalId).toBe("original-ID");
  expect(JSON.stringify(row)).toBe(before);
  const supplied = { ...row, title: " Exact title " };
  expect(actual.rowRecord([supplied])[2].title).toBe(" Exact title ");
});
it("retains explicitly entered titles across previews without inventing one for another row", () => {
  const explicit = { ...row, title: "Reviewed purchase restoration" };
  const result = actual.reconcileRowOverrides({ 2: explicit }, [{ ...row, rowNumber: 3 }]);
  expect(result[2]).toEqual(explicit); expect(result[3].title).toBe("");
});
it("the actual row repair editor preserves exact multiline procedure edits rather than trimming or splitting", () => {
  let changed: typeof row | undefined;
  const tree = actual.RowRepairEditor({ row, onChange: (next: typeof row) => { changed = next; } });
  const areas = elements(tree).filter(node => node.type === "textarea");
  const raw = "  1. Perform action.\n\n  2. Check a|b. \n";
  areas[2]!.props.onChange!({ target: { value: raw } });
  expect(changed?.when).toEqual([raw]);
  expect(changed?.title).toBe(""); expect(changed?.tags).toEqual(row.tags);
  expect(actual.splitEditedLines(raw)).toEqual([raw]);
  expect(renderToStaticMarkup(tree)).toContain("1. Reinstall.\n\n  2. Check a|b.");
});
it("CSV and XLSX previews expose the title, procedure and tag roles separately and with multiline layout", () => {
  expect(source).toContain('<th>Preconditions</th>');
  expect(source).toContain('<th>Actions / procedure</th>');
  expect(source).toContain('<th>Tags</th>');
  expect(source).toContain('row.tags.join(", ")');
  expect(source).toContain('style={{ whiteSpace: "pre-wrap" }}>{row.when.join("\\n") || "—"}');
  expect(source).toContain('style={{ whiteSpace: "pre-wrap" }}>{r.when.join("\\n")}');
  expect(source).not.toContain("suggested titles from stable IDs");
  expect(source).toContain("disabled={loading || Boolean(error) || !mapping.title");
});

it("the actual excluded-row review lists source labels and lets the user include one deliberately", () => {
  const heading = { ...row, externalId: "Section B", given: [], when: [], then: [] };
  let included: typeof heading | undefined;
  const tree = actual.NonCaseRowsReview({ rows: [heading], overrides: {}, onInclude: (next: typeof heading) => { included = next; } });
  const markup = renderToStaticMarkup(tree);
  expect(markup).toContain("automatically mapped");expect(markup).toContain("For review");expect(markup).toContain("Section B");expect(markup).toContain("<table");expect(markup).not.toContain("<ul");
  elements(tree).find(node => node.type === "button")!.props.onClick!();
  expect(included).toEqual(heading);
  expect(actual.NonCaseRowsReview({ rows: [heading], overrides: { 2: { ...heading, title: "Owner supplied case" } }, onInclude: () => undefined })).toBeNull();
});

it("shows suggested row-layout changes and lets the reviewer edit or restore original roles", () => {
  const original = {...row, title: "1. Reinstall. 2. Restore."};
  const proposed = {...row, title: "Verify restoration", tags: [], given: [], when: [original.title], then: ["Purchase restored"]};
  let changed: typeof row | undefined;
  const tree = actual.RowMappingReview({suggestions: [{original, proposed}], overrides: {}, onChange: (next: typeof row) => {changed = next;}});
  const markup = renderToStaticMarkup(tree);
  expect(markup).toContain("automatically applied row-layout suggestions");expect(markup).toContain("For review");expect(markup).toContain("Verify restoration");expect(markup).toContain("Purchase restored");expect(markup).toContain("<table");
  const buttons = elements(tree).filter(node => node.type === "button");
  buttons[0]!.props.onClick!();expect(changed).toEqual(proposed);
  buttons[1]!.props.onClick!();expect(changed).toEqual(original);
  const restored = actual.RowMappingReview({suggestions: [{original, proposed}], overrides: {2: original}, onChange: () => undefined});
  expect(renderToStaticMarkup(restored)).toContain("1. Reinstall. 2. Restore.");
});

it("shows automatically applied type and section suggestions with editable fields and reasons", () => {
  const proposed = { ...row, title: "Verify restoration", suitePath: "Reinstall / Restore", typeRecommendation: "No specialist test-type signal found; Functional is tentative.", reviewReasons: ["Source type missing"] };
  let changed: typeof proposed | undefined;
  const tree = actual.ImportRecommendations({ rows: [proposed], overrides: {}, onChange: (next: typeof proposed) => { changed = next; } });
  const markup = renderToStaticMarkup(tree);
  expect(markup).toContain("Already applied"); expect(markup).toContain("For review");
  expect(markup).toContain("Functional is tentative"); expect(markup).toContain("not verified source facts");
  const nodes = elements(tree);
  nodes.find(node => node.type === "select")!.props.onChange!({ target: { value: "REGRESSION" } });
  expect(changed).toEqual({ ...proposed, testType: "REGRESSION", typeOrigin: "REVIEWER" });
  nodes.find(node => node.type === "input")!.props.onChange!({ target: { value: "Restore purchases" } });
  expect(changed).toEqual({ ...proposed, suitePath: "Restore purchases" });
  expect(actual.ImportRecommendations({ rows: [], overrides: {}, onChange: () => undefined })).toBeNull();
});

it("shows semantic objective, confidence and exact case evidence without overriding a human type", () => {
  const proposed = { ...row, title: "Verify analytics dashboard", testType: "OTHER", typeOrigin: "UNCLASSIFIED" };
  const result = { id: '["",2]', fingerprint: "receipt", testType: "FUNCTIONAL", confidence: "HIGH", objective: "Check dashboard count accuracy", reason: "Compares a displayed value with backend data, not telemetry emission.", evidence: ["Count equals backend"] };
  const markup = renderToStaticMarkup(actual.ImportRecommendations({ rows: [proposed], overrides: {}, analysis: { 2: result }, onChange: () => {} }));
  expect(markup).toContain("Check dashboard count accuracy"); expect(markup).toContain("high confidence");
  expect(markup).toContain("<blockquote"); expect(markup).toContain("Count equals backend");
  expect(markup).toContain('value="FUNCTIONAL" selected');
  const manual = renderToStaticMarkup(actual.ImportRecommendations({ rows: [proposed], overrides: { 2: { ...proposed, testType: "REGRESSION", typeOrigin: "REVIEWER" } }, analysis: { 2: result }, onChange: () => {} }));
  expect(manual).toContain('value="REGRESSION" selected'); expect(manual).not.toContain("Check dashboard count accuracy");
  const unknown = renderToStaticMarkup(actual.ImportRecommendations({ rows: [proposed], overrides: {}, analysis: { 2: { ...result, testType: null, confidence: "LOW", evidence: [] } }, onChange: () => {} }));
  expect(unknown).toContain("Unclassified"); expect(unknown).toContain("low confidence");
});

it("includes newly repaired incomplete rows and deliberately rescued cases in automatic semantic review", () => {
  const existing = { ...row, title: "Original case" };
  const repaired = { ...row, rowNumber: 3, title: "Repaired name", typeOrigin: "UNCLASSIFIED" };
  const rescued = { ...row, rowNumber: 4, title: "Deliberately added case", typeOrigin: "UNCLASSIFIED" };
  expect(importReviewRows([existing], { 3: repaired, 4: rescued })).toEqual([existing, repaired, rescued]);
  expect(importReviewRows([existing], { 2: { ...existing, title: "Edited case" } })[0]?.title).toBe("Edited case");
  expect(existing.title).toBe("Original case");
});
