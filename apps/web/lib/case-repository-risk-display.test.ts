import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

// Actual current risk cell and tone expression with synthetic supplied values.
// This does not load a repository, assess risk or establish native acceptance.
const source = readFileSync(new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node: ts.Node, match: (node: ts.Node) => boolean): ts.Node | undefined {
  if (match(node)) return node;
  let result: ts.Node | undefined;
  ts.forEachChild(node, child => { if (!result) result = find(child, match); });
  return result;
}
const cell = find(ast, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "td" &&
  node.openingElement.attributes.properties.some(attribute => attribute.getText(ast) === 'data-label="Risk"'));
const tone = find(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "riskTone");
if (!cell || !tone) throw Error("Actual repository risk cell or tone expression missing");
const compiled = ts.transpileModule(`exports.render = (tc) => { const ${tone.getText(ast)}; return (${cell.getText(ast)}); };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
type SyntheticCase = Readonly<{ id: string; displayId: string; riskScore?: number | null; riskSeverity?: string | null }>;
const exports: { render?: (tc: SyntheticCase) => React.ReactElement<{ children: React.ReactNode }> } = {};
new Function("exports", "React", compiled)(exports, React);
const render = exports.render;
if (!render) throw Error("Actual repository risk renderer missing");

function childrenOfType(element: React.ReactElement<{ children?: React.ReactNode }>, type: string) {
  return React.Children.toArray(element.props.children).filter((child): child is React.ReactElement<Record<string, unknown>> => React.isValidElement(child) && child.type === type);
}
function riskCell(tc: SyntheticCase) {
  const element = render!(tc);
  const content = childrenOfType(element, "div")[0];
  if (!content) throw Error("Actual risk content missing");
  return { element, content, html: renderToStaticMarkup(element) };
}

it.each([null, undefined])("unassessed synthetic score %s keeps the actual unknown text/tone and has no fabricated meter", riskScore => {
  const tc = Object.freeze({ id: "stable-native-case", displayId: "TC-851", riskScore, riskSeverity: null });
  const rendered = riskCell(tc);
  expect(rendered.content.props.className).toBe("case-risk case-risk-unscored");
  expect(rendered.content.props.title).toBe("Risk has not been assessed");
  expect(childrenOfType(rendered.content, "span")[0]?.props.children).toBe("Not assessed");
  expect(childrenOfType(rendered.content, "i")).toEqual([]);
  expect(rendered.html).not.toMatch(/<i\b|<b\b|width:/);
  expect(tc).toEqual({ id: "stable-native-case", displayId: "TC-851", riskScore, riskSeverity: null });
});

it.each([
  { score: 0, tone: "low" }, { score: 1, tone: "low" }, { score: 39, tone: "low" },
  { score: 40, tone: "medium" }, { score: 69, tone: "medium" },
  { score: 70, tone: "high" }, { score: 100, tone: "high" },
])("supplied synthetic risk $score retains exact proportional width and existing $tone threshold", ({ score, tone }) => {
  const tc = Object.freeze({ id: "stable-native-case", displayId: "TC-851", riskScore: score, riskSeverity: null });
  const rendered = riskCell(tc), meter = childrenOfType(rendered.content, "i")[0];
  expect(meter).toBeDefined();
  const fill = childrenOfType(meter!, "b")[0];
  expect(fill?.props.style).toEqual({ width: `${score}%` });
  expect(rendered.content.props.className).toBe(`case-risk case-risk-${tone}`);
  expect(rendered.content.props.title).toBe(`Risk: ${score}/100`);
  expect(childrenOfType(rendered.content, "span")[0]?.props.children).toBe(`${score}/100`);
  expect(tc).toEqual({ id: "stable-native-case", displayId: "TC-851", riskScore: score, riskSeverity: null });
});

it("actual severity title remains literal escaped text, with no new content or actions", () => {
  const severity = '<img src=x onerror="literal">\nretained & severity';
  const rendered = riskCell(Object.freeze({ id: "stable", displayId: "TC-1", riskScore: 70, riskSeverity: severity }));
  expect(rendered.content.props.title).toBe(`${severity}: 70/100`);
  expect(rendered.html).toContain('&lt;img src=x onerror=&quot;literal&quot;&gt;');
  expect(rendered.html).not.toMatch(/<img\b|<script\b|<button\b|<a\b/);
});

it("repeated synthetic risk cells retain all 851 input identities and distinct unknown/zero/one scores without clipping", () => {
  const cases = Array.from({ length: 851 }, (_, index) => Object.freeze({ id: `stable-${index}`, displayId: `TC-${index + 1}`, riskScore: [null, 0, 1, 70][index % 4], riskSeverity: null }));
  const originals = cases.map(tc => ({ ...tc }));
  const outputs = cases.map(tc => riskCell(tc));
  expect(outputs).toHaveLength(851);
  expect(cases).toEqual(originals);
  for (let index = 0; index < outputs.length; index++) {
    const score = cases[index]!.riskScore, meters = childrenOfType(outputs[index]!.content, "i");
    if (score == null) expect(meters).toEqual([]);
    else expect(childrenOfType(meters[0]!, "b")[0]?.props.style).toEqual({ width: `${score}%` });
  }
});
