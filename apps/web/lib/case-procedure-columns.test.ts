import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";
import type { CaseProcedureColumns } from "../components/CaseProcedureColumns";
import { technicalBehaviorLabel } from "./case-authoring-fields";

type Props = Parameters<typeof CaseProcedureColumns>[0];
const source = readFileSync(
  new URL("../components/CaseProcedureColumns.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "CaseProcedureColumns.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
// Execute the actual component function with React SSR, without importing an
// application/router/auth graph. This is synthetic markup proof, not a browser
// or native reader/procedure acceptance test.
const functions = ast.statements
  .filter(ts.isFunctionDeclaration)
  .map((node) =>
    ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast)
      .replace(/\bexport\s+/, ""),
  )
  .join("\n");
const code = ts.transpileModule(
  `${functions}\nthis.component = CaseProcedureColumns;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } },
).outputText;
function render(props: Props) {
  const context = vm.createContext({ React, technicalBehaviorLabel });
  vm.runInContext(code, context);
  const component = (context as unknown as { component: (props: Props) => React.ReactNode }).component;
  return renderToStaticMarkup(React.createElement(component, props));
}
function cells(html: string) {
  return [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
}

it("actual procedure SSR distinguishes explicit empty text from absent and NULL fields", () => {
  const empty = render({ steps: [{ action: "Click", expectedActionOrData: "", expectedResult: "", expectedResponse: "" }] });
  const missing = render({ steps: [{ action: "Click" }] });
  const nullable = render({ steps: [{ action: "Click", expectedActionOrData: null, expectedResult: null, expectedResponse: null }] });
  expect(empty).not.toBe(nullable);
  expect(cells(empty)).toEqual(["Click", "<em>Empty text</em>", "<em>Empty text</em>", "<em>Empty text</em>"]);
  expect(cells(missing)).toEqual(["Click", "Not supplied", "Not supplied", "Not supplied"]);
  expect(nullable).toBe(missing);
});

it("retained empty action is visible without becoming a fake absent procedure row", () => {
  expect(cells(render({ steps: [{ action: "", expectedActionOrData: "API call" }] })))
    .toEqual(["<em>Empty text</em>", "API call", "Not supplied", "Not supplied"]);
});

it("whitespace and multiline values remain exact across every aligned field", () => {
  const step = { action: " Click\nbutton ", expectedActionOrData: " \n ", expectedResult: " View\nupdates ", expectedResponse: " HTTP 200\n{} " };
  expect(cells(render({ steps: [step] }))).toEqual(Object.values(step));
  expect(render({ steps: [step] })).toContain("white-space:pre-wrap");
});

it("custom labels including empty labels stay exact while only the legacy technical default is normalized", () => {
  const labels = { action: "Tester gesture", expectedActionOrData: "Engine event", expectedResult: "", expectedResponse: " Network\nresponse " };
  const html = render({ steps: [{ action: "Click" }], labels });
  for (const label of ["Tester gesture", "Engine event", " Network\nresponse "]) expect(html).toContain(label);
  expect(html).toContain('<th scope="col"></th>');
  expect(html).not.toContain("Technical behavior / data");
  expect(render({ steps: [], labels: { expectedActionOrData: "Expected Action / Data" } })).toContain("Technical behavior / data");
  expect(render({ steps: [], labels: { expectedActionOrData: "" } })).not.toContain("Technical behavior / data");
});

it("React escapes retained procedure prose and column labels instead of executing markup", () => {
  const html = render({ steps: [{ action: "<script>alert(1)</script>", expectedActionOrData: '<img src="x" onerror="fail()">', expectedResult: "A & B", expectedResponse: "<response>" }], labels: { action: "<label>" } });
  for (const escaped of ["&lt;script&gt;", "&lt;img", "&lt;label&gt;", "A &amp; B", "&lt;response&gt;"]) expect(html).toContain(escaped);
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img ");
});

it("stored array order, duplicate rows, raw inputs and media reference counts remain unchanged", () => {
  const first = Object.freeze({ action: "Second in authored naming", expectedActionOrData: "", expectedResult: null, expectedResponse: "line\nresponse", mediaAttachmentIds: Object.freeze(["same", "same"]) });
  const last = Object.freeze({ action: "First in authored naming" });
  const steps = Object.freeze([first, first, last]);
  const before = JSON.stringify(steps);
  const html = render({ steps });
  expect(html.indexOf("Second in authored naming")).toBeLessThan(html.indexOf("First in authored naming"));
  expect(html.match(/Second in authored naming/g)).toHaveLength(2);
  expect(html.match(/2 linked references/g)).toHaveLength(2);
  expect(html).toContain("0 linked references");
  expect(html).toContain("preview does not fetch or verify media");
  for (const position of [1, 2, 3]) expect(html).toContain(`<th scope="row">${position}</th>`);
  expect(JSON.stringify(steps)).toBe(before);
});

it("caption states the empty-versus-absent distinction without a readiness or media availability claim", () => {
  const html = render({ steps: [] });
  expect(html).toContain("Explicit empty text is labeled separately");
  expect(html).toContain("absent fields are shown as not supplied");
  expect(html).not.toContain("Empty expected fields are shown as not");
  expect(html).not.toContain('scope="row"');
  expect(html).not.toContain("Media references");
});
