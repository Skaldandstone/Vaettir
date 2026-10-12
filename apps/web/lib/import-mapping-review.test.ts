// Real local repair helpers/JSX with synthetic event callbacks. No files or
// customer records are uploaded or modified by these fixtures.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";

const source = readFileSync(new URL("../components/MigrationWizard.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("Migration.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["rowRecord", "reconcileRowOverrides", "splitEditedLines", "RowRepairEditor"];
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""));
if (declarations.length !== names.length) throw Error("Actual import repair declarations missing");
const code = ts.transpileModule(declarations.map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const actual = new Function("React", code + "\nreturn { rowRecord, reconcileRowOverrides, splitEditedLines, RowRepairEditor };")(React);
const row = { rowNumber: 2, title: "", externalId: "original-ID", tags: ["Not a case name"], given: [" Setup\n  kept "], when: ["1. Reinstall.\n\n  2. Check a|b."], then: [" Expected\nvalue "], priority: "MEDIUM", testType: "FUNCTIONAL", automationStatus: "MANUAL" };
function elements(root: React.ReactNode): React.ReactElement<{ children?: React.ReactNode; onChange?: (event: { target: { value: string } }) => void }>[] {
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
  areas[1]!.props.onChange!({ target: { value: raw } });
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
