import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

type Step = { order: number; action: string; expectedActionOrData: string | null; expectedResult: string | null; expectedResponse: string | null; mediaAttachmentIds: string[] };
type Element = React.ReactElement<{ children?: React.ReactNode; style?: React.CSSProperties }>;
const source = readFileSync(new URL("../components/TestCaseDetailContent.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("Detail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const cells: ts.JsxElement[] = [];
function visit(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "td" && node.children.some(child => ts.isJsxExpression(child) && child.expression?.getText(ast).includes("s.expectedResult"))) cells.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
if (cells.length !== 1 || !ts.isJsxElement(cells[0]!.parent)) throw Error("Exactly one actual saved expected-result cell and row required");
const cell = cells[0]!, row = cell.parent;
const styles = ast.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ["cellStyle", "procedureTextCellStyle"].includes(declaration.name.getText(ast)))).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n");
const context = vm.createContext({ React, showTechnicalBehavior: true, showExpectedResponse: true });
vm.runInContext(ts.transpileModule(styles + `\nthis.cell=(s)=>(${printer.printNode(ts.EmitHint.Unspecified, cell, ast)});\nthis.row=(s)=>(${printer.printNode(ts.EmitHint.Unspecified, row, ast)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText, context);
const actual = context as unknown as { cell(step: Step): Element; row(step: Step): Element };
const step = (expectedResult: string | null, order = 0): Step => ({ order, action: "Click this button", expectedActionOrData: "OnclickFunction triggers API GET to apiURL", expectedResult, expectedResponse: "200 response", mediaAttachmentIds: [] });
function elements(node: React.ReactNode): Element[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node as Element, ...React.Children.toArray(node.props.children).flatMap(elements)];
}

describe("actual saved expected-result cell/paired row, source JSX SSR only", () => {
  it("distinguishes absent NULL from supplied empty text without a blank valid-empty cell", () => {
    const absent = actual.cell(step(null)), empty = actual.cell(step(""));
    expect(absent.props.children).toBe("Not supplied");
    expect(React.isValidElement(empty.props.children)).toBe(true);
    const marker = empty.props.children as React.ReactElement<{ children: string }>;
    expect(marker.type).toBe("em"); expect(marker.props.children).toBe("Empty text");
    expect(renderToStaticMarkup(absent)).toContain(">Not supplied</td>");
    expect(renderToStaticMarkup(empty)).toContain("<em>Empty text</em>");
    expect(renderToStaticMarkup(empty)).not.toMatch(/<td[^>]*><\/td>/);
  });
  it.each([" \n \t", " Expected\n  visible result \n", "λ 🎮\n次の結果", "Long line ".repeat(250) + "\nLAST EXACT LINE"])(
    "preserves raw supplied prose %j and its existing wrapping without normalization", expectedResult => {
      const input = step(expectedResult), before = JSON.stringify(input), element = actual.cell(input);
      expect(element.props.children).toBe(expectedResult);
      expect(element.props.style).toMatchObject({ whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
      expect(renderToStaticMarkup(element)).toContain(expectedResult);
      expect(renderToStaticMarkup(element)).not.toMatch(/line-clamp|text-overflow|overflow:\s*hidden/);
      expect(JSON.stringify(input)).toBe(before);
    },
  );
  it("escapes arbitrary markup as text without adding executable elements", () => {
    const raw = '<script>synthetic</script>\n<img src=x onerror="synthetic"> & result', element = actual.cell(step(raw));
    expect(element.props.children).toBe(raw);
    const html = renderToStaticMarkup(element);
    expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;synthetic&quot;&gt; &amp; result");
    expect(html).not.toMatch(/<(?:script|img|button|input|textarea|form)\b/);
  });
  it("keeps actual numbering and aligned action/technical/result/response cells for every stored row including duplicates", () => {
    const raw = " Duplicate\nexpected result ", inputs = [step(raw, 0), step(raw, 1)], before = JSON.stringify(inputs);
    for (const input of inputs) {
      const rendered = actual.row(input), cells = elements(rendered).filter(node => node.type === "td");
      expect(cells).toHaveLength(5);
      expect(cells[0]!.props.children).toBe(input.order + 1);
      expect(elements(cells[1]).find(node => node.type === "div")!.props.children).toBe(input.action);
      expect(cells[2]!.props.children).toBe(input.expectedActionOrData);
      expect(cells[3]!.props.children).toBe(raw);
      expect(cells[4]!.props.children).toBe(input.expectedResponse);
    }
    expect(inputs.map(input => actual.cell(input).props.children)).toEqual([raw, raw]);
    expect(JSON.stringify(inputs)).toBe(before);
    let parent: ts.Node | undefined = row, storedMap = false;
    while (parent) { if (ts.isCallExpression(parent) && parent.expression.getText(ast) === "tc.steps.map") storedMap = true; parent = parent.parent; }
    expect(storedMap).toBe(true);
  });
});
