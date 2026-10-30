import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// React 19 no longer ships UMD files. Bundle the installed React/ReactDOM pair
// together so these browser fixtures exercise one real shared hook dispatcher.
export function reactBrowserScripts() {
  const webPackage = new URL("../../apps/web/package.json", import.meta.url);
  const require = createRequire(webPackage);
  const viteRequire = createRequire(
    createRequire(require.resolve("vitest")).resolve("vite"),
  );
  const { buildSync } = viteRequire("esbuild");
  const result = buildSync({
    stdin: {
      contents: `import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
globalThis.React = React;
globalThis.ReactDOM = { ...ReactDOM, createRoot };`,
      resolveDir: dirname(fileURLToPath(webPackage)),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  return {
    "/react.js": result.outputFiles[0].text,
    "/react-dom.js": "/* ReactDOM is included in the shared React bundle. */",
  };
}

// Include the actual shared controls in older synthetic-transport fixtures.
// Isolate their module bindings while retaining real React DOM and tooltips.
export function actionButtonBrowserSource() {
  const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const ts = require("typescript");
  const compiled = ["FloatingTooltip.tsx", "ActionButton.tsx"].map(name => {
    const path = new URL("../../apps/web/components/ui/" + name, import.meta.url);
    const source = ts.createSourceFile(name, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const ast = ts.factory.updateSourceFile(source, source.statements.filter(node => !ts.isImportDeclaration(node)));
    return ts.transpileModule(ts.createPrinter().printFile(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
    }).outputText.replace(/^export /gm, "");
  }).join("\n");
  return `const {ActionButton}=(()=>{const {Children,isValidElement,forwardRef,useEffect,useId,useLayoutEffect,useRef,useState}=React;const {createPortal}=ReactDOM;\n${compiled}\nreturn {ActionButton};})();`;
}
