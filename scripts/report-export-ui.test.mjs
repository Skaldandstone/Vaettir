/* global document, window */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const fixture = readFileSync(root + "apps/web/lib/report-deck.test.ts", "utf8");
const report = fixture.slice(fixture.indexOf("const report ="), fixture.indexOf('describe("editable report deck"'));
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {FrozenReport} from './components/FrozenReport';${report}
window.createdDownloads=[];const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.createdDownloads.push({size:blob.size,type:blob.type});return original(blob)};
function App(){const [allowed,setAllowed]=React.useState(true);const [current,setCurrent]=React.useState(report);window.changeExportAccess=setAllowed;window.switchReport=()=>setCurrent({...report,title:'Another report'});return <FrozenReport report={current} allowExport={allowed} projectId='synthetic-project' snapshotId='synthetic-snapshot'/>;}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root + "apps/web", loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "isolated-export-boundaries", setup(build) {
  build.onResolve({ filter: /ReportSnapshotEvidence$/ }, () => ({ path: "evidence", namespace: "fixture" }));
  build.onResolve({ filter: /^@\/lib\/report-deck$/ }, () => ({ path: "deck", namespace: "fixture" }));
  build.onResolve({ filter: /^@\/lib\/report-office$/ }, () => ({ path: "office", namespace: "fixture" }));
  build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "deck" ? `import {renderReportDeck as render} from './lib/report-deck';export async function renderReportDeck(report){await new Promise(resolve=>{window.releaseExport=resolve});return render(report);}` : args.path === "office" ? `import {renderReportDocument as doc,renderReportWorkbook as book} from './lib/report-office';async function wait(){await new Promise(resolve=>{window.releaseExport=resolve});if(window.failExport)throw Error('synthetic recoverable failure');}export async function renderReportDocument(report){await wait();return doc(report)}export async function renderReportWorkbook(report){await wait();return book(report)}` : `export function ReportSnapshotEvidence(){return null}`, loader: "js", resolveDir: root + "apps/web" }));
} }] });
test("browser Office exports work, recover from errors and discard output after access changes", async () => {
  const server = createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><div id="root"></div>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), origin = `http://127.0.0.1:${server.address().port}`, errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.route("**/*", route => route.request().url().startsWith(origin + "/") || route.request().url().startsWith("blob:") ? route.continue() : route.abort());
    await page.goto(origin); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Download editable PowerPoint" }).click();
    await page.waitForFunction(() => typeof window.releaseExport === "function");
    await page.evaluate(() => window.changeExportAccess(false));
    await page.evaluate(() => window.releaseExport());
    await page.waitForFunction(() => !document.body.textContent.includes("Creating PowerPoint"));
    assert.deepEqual(await page.evaluate(() => window.createdDownloads), []);
    await page.evaluate(() => { window.changeExportAccess(true); window.releaseExport = null; });
    await page.getByRole("button", { name: "Download editable PowerPoint" }).click();
    await page.waitForFunction(() => typeof window.releaseExport === "function");
    await page.evaluate(() => window.switchReport());
    await page.evaluate(() => window.releaseExport());
    await page.waitForFunction(() => !document.body.textContent.includes("Creating PowerPoint"));
    assert.deepEqual(await page.evaluate(() => window.createdDownloads), []);
    assert.equal(await page.getByRole("checkbox").isChecked(), false);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Download editable PowerPoint" }).click();
    await page.waitForFunction(() => typeof window.releaseExport === "function");
    const download = page.waitForEvent("download");
    await page.evaluate(() => window.releaseExport());
    const result = await download;
    assert.match(result.suggestedFilename(), /\.pptx$/);
    const created = await page.evaluate(() => window.createdDownloads); assert.equal(created.length, 1); assert.ok(created[0].size > 10000);
    await page.getByText("Other editable formats", { exact: true }).click();
    for (const [label, extension] of [["Word document", "docx"], ["Excel workbook", "xlsx"]]) {
      await page.evaluate(() => { window.releaseExport = null; });
      await page.getByRole("button", { name: `Download ${label}` }).click();
      await page.waitForFunction(() => typeof window.releaseExport === "function");
      await page.evaluate(() => window.changeExportAccess(false));
      await page.getByRole("checkbox").waitFor({ state: "detached" });
      await page.evaluate(() => window.releaseExport());
      await page.waitForFunction(() => !document.body.textContent.includes("Creating"));
      assert.equal((await page.evaluate(() => window.createdDownloads)).length, created.length);
      await page.evaluate(() => { window.changeExportAccess(true); window.releaseExport = null; window.failExport = true; });
      await page.getByText("Other editable formats", { exact: true }).click();
      await page.getByRole("button", { name: `Download ${label}` }).click();
      await page.waitForFunction(() => typeof window.releaseExport === "function");
      await page.evaluate(() => window.releaseExport());
      await page.getByRole("alert").filter({ hasText: "could not be created" }).waitFor();
      await page.evaluate(() => { window.failExport = false; window.releaseExport = null; });
      await page.getByRole("button", { name: `Download ${label}` }).click();
      await page.waitForFunction(() => typeof window.releaseExport === "function");
      const officeDownload = page.waitForEvent("download");
      await page.evaluate(() => window.releaseExport());
      assert.ok((await officeDownload).suggestedFilename().endsWith(`.${extension}`));
      created.push({});
      assert.equal((await page.evaluate(() => window.createdDownloads)).length, created.length);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
