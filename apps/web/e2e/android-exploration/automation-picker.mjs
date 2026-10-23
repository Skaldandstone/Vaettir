// Render the actual draft picker and its actual parent prop binding. This
// catches the CUSTOM-family enum boundary that a mapping-only unit test misses.
// Saved-draft/provider hooks and the separate design reviewer are synthetic;
// this never generates a draft, charges credits or accesses a hosted account.
/* global window, document */
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(path.join(web, "package.json"));
const viteRequire = createRequire(
  createRequire(require.resolve("vitest")).resolve("vite"),
);
const { build } = viteRequire("esbuild"),
  { chromium } = require("@playwright/test");
const sourcePath = path.join(web, "components/TestCaseDetailContent.tsx"),
  source = await readFile(sourcePath, "utf8");
const tree = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  ),
  printer = ts.createPrinter();
const functions = tree.statements.filter(
  (n) =>
    ts.isFunctionDeclaration(n) && n.name?.text === "AutomationDraftSection",
);
const options = tree.statements.filter(
  (n) =>
    ts.isVariableStatement(n) &&
    n.declarationList.declarations.some(
      (d) => d.name.getText(tree) === "AUTOMATION_FRAMEWORKS",
    ),
);
const calls = [];
function visit(n) {
  if (
    ts.isJsxSelfClosingElement(n) &&
    n.tagName.getText(tree) === "AutomationDraftSection"
  )
    calls.push(n);
  ts.forEachChild(n, visit);
}
visit(tree);
assert.equal(functions.length, 1);
assert.equal(options.length, 1);
assert.equal(calls.length, 1);
const print = (n) => printer.printNode(ts.EmitHint.Unspecified, n, tree);
const fixture = `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {automationTargetForFramework} from '../../packages/core/src/qualityExperience.ts';
window.pickerMutations=0;
const mutation=()=>({isPending:false,mutateAsync:async()=>{window.pickerMutations++;throw Error('No paid operation admitted');}});
const trpcReact={testCases:{automationDraft:{useQuery:()=>({data:null,isLoading:false,error:null})},rejectAutomationDraft:{useMutation:mutation},generateAutomationDraft:{useMutation:mutation}}};
const TestDesignReview=()=>null;
${print(options[0])}
${print(functions[0])}
const root=createRoot(document.getElementById('root'));
window.renderPicker=(source)=>{const tc={id:crypto.randomUUID(),source};const readOnly=false;root.render(${print(calls[0])});};`;
const bundle = await build({
  stdin: { contents: fixture, resolveDir: web, loader: "tsx" },
  bundle: true,
  write: false,
  jsx: "automatic",
  platform: "browser",
  nodePaths: [path.join(web, "node_modules")],
});
const css =
  (await readFile(path.join(web, "app/globals.css"), "utf8")).replace(
    /^@import[^\r\n]+\r?\n/,
    "",
  ) + (await readFile(path.join(web, "app/workbench.css"), "utf8"));
const output = path.resolve(
  process.argv[2] ??
    path.join(
      web,
      "../../.local/android-exploration-20261022/automation-picker",
    ),
);
await mkdir(output, { recursive: true });
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("content-type", "application/javascript");
    res.end(bundle.outputFiles[0].text);
  } else {
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main style="max-width:960px;margin:16px;padding:12px"><div id="root"></div></main><script src="/bundle.js"></script></body></html>`,
    );
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch({ headless: true }),
  page = await browser.newPage();
const errors = [],
  unexpected = [];
const checks = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/*", (route) => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  unexpected.push(route.request().url());
  return route.abort();
});
try {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.renderPicker === "function");
  for (const [source, expected] of [
    [
      { frameworkFamily: "CUSTOM", framework: "android-exploration" },
      "UI_AUTOMATOR",
    ],
    [
      { frameworkFamily: "PYTEST", framework: "retained-source-name" },
      "PYTEST",
    ],
    [{ frameworkFamily: "CUSTOM", framework: "unrecognized-source" }, ""],
    [null, ""],
  ]) {
    await page.evaluate((source) => window.renderPicker(source), source);
    await page
      .getByText("Prepare an automation draft", { exact: true })
      .click();
    const picker = page.getByRole("combobox", {
      name: /^Framework/,
    });
    assert.equal(await picker.inputValue(), expected);
    if (expected === "UI_AUTOMATOR")
      assert.ok(
        (await page.locator("small").innerText()).includes(
          "android-exploration",
        ),
      );
    checks.push(expected || "No inferred default");
  }
  await page.evaluate(() =>
    window.renderPicker({
      frameworkFamily: "CUSTOM",
      framework: "android-exploration",
    }),
  );
  await page.getByText("Prepare an automation draft", { exact: true }).click();
  for (const theme of ["dark", "light"])
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await page.evaluate(
        (t) => (document.documentElement.dataset.theme = t),
        theme,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(output, `picker-${theme}-${width}.png`),
      });
    }
  assert.equal(await page.evaluate(() => window.pickerMutations), 0);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        checks,
        themes: ["dark", "light"],
        widths: [1280, 390],
        providerCalls: 0,
        paidMutations: 0,
        boundary:
          "Actual picker and parent binding; synthetic saved-draft/design hooks. No hosted identity, physical execution, network evidence or generated source acceptance.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
