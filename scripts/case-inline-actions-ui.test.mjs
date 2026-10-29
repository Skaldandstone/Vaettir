/* global requestAnimationFrame, getComputedStyle */
/* global document, window */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
test("direct case tools support keyboard, scope, busy and archived states without a submenu", async () => {
  const bundle = await build({ stdin: { resolveDir: root + "apps/web", loader: "tsx", contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{CaseInlineActions}from'./components/CaseInlineActions';
    window.actions=[];function App(){const[state,setState]=useState({canEdit:true,busy:false,exporting:false,canRun:true,canArchive:true,canRestore:false});window.state=setState;
    const action=k=>()=>window.actions.push(k);return <main style={{padding:20,maxWidth:360}}><h1>Case tools</h1><CaseInlineActions name="SYN-01" {...state} onRun={action('run')} onEdit={action('edit')} onMove={action('move')} onTag={action('tag')} onCsv={action('csv')} onJson={action('json')} onReview={action('review')} onArchive={action('archive')} onRestore={action('restore')} onDelete={action('delete')}/></main>}
    createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  const css = readFileSync(root + "apps/web/app/globals.css", "utf8").replace(/^@import[^\n]+/gm, "");
  const server = createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end(`<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const tools = page.getByRole("group", { name: "Actions for SYN-01" });
    await tools.getByRole("button", { name: "Run SYN-01", exact: true }).focus();
    await page.keyboard.press("Enter");
    await tools.getByRole("button", { name: "Move SYN-01 to a test plan" }).focus();
    await page.getByRole("tooltip").filter({ hasText: "Move SYN-01" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("tooltip").count(), 0);
    await page.keyboard.press("Space");
    await tools.getByRole("button", { name: "Export SYN-01 as CSV", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.actions), ["run", "move", "csv"]);
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.evaluate(() => window.state(s => ({ ...s, busy: true })));
    await page.waitForFunction(() => document.querySelector('[aria-label="Delete SYN-01"]').disabled);
    await page.evaluate(() => window.state(s => ({ ...s, busy: false, canRun: false, canArchive: false, canRestore: true })));
    await tools.getByRole("button", { name: "Restore SYN-01" }).click();
    assert.equal(await tools.getByRole("button", { name: "Archive SYN-01", exact: true }).count(), 0);
    assert.equal(await tools.getByRole("button", { name: "Run SYN-01", exact: true }).isDisabled(), true);
    const dir = root + ".local/import-mapping-queue-20261029"; mkdirSync(dir, { recursive: true });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(async t => {
        document.documentElement.dataset.theme = t;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.allSettled(document.getAnimations().map(animation => animation.finished));
      }, theme);
      await page.waitForFunction(t => getComputedStyle(document.documentElement).colorScheme === t, theme);
      await page.screenshot({ path: `${dir}/inline-actions-${theme}.png` });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.evaluate(() => window.state(s => ({ ...s, canEdit: false })));
    await page.waitForFunction(() => !document.querySelector('[aria-label="Delete SYN-01"]'));
    assert.equal(await tools.getByRole("button").count(), 2);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
