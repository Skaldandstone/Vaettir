import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";

// Actual renderer, installed React hooks. Select is a DOM-only boundary.
const source = readFileSync(new URL("../components/ArchitectureMap.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {};
new Function("require", "exports", "React", output)((name: string) => {
  if (name === "react") return React;
  if (name === "./ui/ReadableSelect") return { ReadableSelect: (props: Record<string, unknown>) => React.createElement("select", props) };
  throw Error(`Unexpected dependency: ${name}`);
}, exports, React);
const render = (elements: unknown[], reviewedLinks = new Map<string, number>()) => renderToStaticMarkup(React.createElement(exports.ArchitectureMap!, { elements, reviewedLinks }));

it("draws only explicit resolvable relations and distinguishes traceability from coverage", () => {
  const html = render([
    { id: "a", kind: "COMPONENT", label: "API" }, { id: "b", kind: "COMPONENT", label: "Store" },
    { id: "c", kind: "COMPONENT", label: "Unconnected" },
    { id: "edge", kind: "INTERACTION", from: "a", to: "b", label: "Writes" },
    { id: "unknown", kind: "INTERACTION", from: "a", to: "missing", label: "Unresolved" },
  ], new Map([["a", 2]]));
  expect(html).toContain("1 explicit relations in this view");
  expect(html).toContain("API: 2 confirmed test links");
  expect(html).toContain("Store: 0 confirmed test links");
  expect(html).not.toContain("Unconnected: 0 confirmed test links");
  expect(html).toContain("do not imply execution or coverage");
  expect(html).not.toContain("<title>Unresolved</title>");
});
it("never executes or embeds document markup in labels", () => {
  const html = render([{ id: "a", kind: "COMPONENT", label: '<script>alert("x")</script>' }]);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("No connections have been inferred");
});
it("shows an honest text-only state without inventing components", () => {
  const html = render([{ id: "note", kind: "TEXT", label: "A diagram note" }]);
  expect(html).toContain("Review the extracted text below");
  expect(html).not.toContain("<svg");
});
