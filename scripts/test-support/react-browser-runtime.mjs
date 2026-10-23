import { createRequire } from "node:module";
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
