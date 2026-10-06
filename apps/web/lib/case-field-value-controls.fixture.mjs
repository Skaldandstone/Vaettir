// Executes only checked-in browser-pure source with synthetic values. This
// fixture proves handlers/static render, not authenticated browser acceptance.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import React from "react";
import ts from "typescript";
export const caseFieldValueControlSource = readFileSync(
  new URL("../components/CaseFieldValueControls.tsx", import.meta.url),
  "utf8",
);
const apiRequire = createRequire(
  new URL("../../api/package.json", import.meta.url),
);
function apiModule(name) {
  const code = readFileSync(
      new URL(`../../api/src/services/${name}.ts`, import.meta.url),
      "utf8",
    ),
    module = { exports: {} };
  const compiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    TextEncoder,
    Object,
    Array,
    require: (path) =>
      path.startsWith("./")
        ? apiModule(path.slice(2).replace(/\.js$/, ""))
        : apiRequire(path),
  });
  return module.exports;
}
const native = apiModule("caseFieldSchema"),
  presentation = apiModule("caseFieldPresentationSchema");
const ast = ts.createSourceFile(
    "CaseFieldValueControls.tsx",
    caseFieldValueControlSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  ),
  printer = ts.createPrinter();
const declarations = ast.statements
  .filter(ts.isFunctionDeclaration)
  .map((node) =>
    printer
      .printNode(ts.EmitHint.Unspecified, node, ast)
      .replace(/^export /, ""),
  );
const compiled = ts.transpileModule(declarations.join("\n"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
    jsx: ts.JsxEmit.React,
  },
}).outputText;
export function caseFieldValueControlHarness() {
  const sandbox = {
    React,
    useState: React.useState,
    useEffect: React.useEffect,
    useId: React.useId,
    useRef: React.useRef,
    ...native,
    ...presentation,
  };
  vm.createContext(sandbox);
  vm.runInContext(compiled, sandbox);
  return sandbox;
}
export function caseFieldValueControlHost(h) {
  const hooks = [];
  let cursor = 0;
  h.useId = () => "synthetic-field-host";
  h.useEffect = (callback) => callback();
  h.useRef = (initial) => {
    const index = cursor++;
    return (hooks[index] ??= { current: initial });
  };
  h.useState = (initial) => {
    const index = cursor++;
    if (!Object.hasOwn(hooks, index)) hooks[index] = initial;
    return [
      hooks[index],
      (value) => {
        hooks[index] =
          typeof value === "function" ? value(hooks[index]) : value;
      },
    ];
  };
  return (props) => {
    cursor = 0;
    return h.CaseFieldValueControls(props);
  };
}
export function caseFieldValueControlElements(element) {
  return !React.isValidElement(element)
    ? []
    : [
        element,
        ...React.Children.toArray(element.props.children).flatMap(
          caseFieldValueControlElements,
        ),
      ];
}
