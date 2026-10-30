// Run directly with node --test. No app server, auth, customer data or database.
// Intentionally separate from the hosted/authenticated Playwright suites.
/* global document, innerWidth, window, getComputedStyle */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const proofRoot = fileURLToPath(new URL("../../../.local/compliance-coverage-20261030/ui-followup-20261030/", import.meta.url));
// Font URLs contain semicolons; strip the whole import line, not part of its URL.
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(/^@import[^\r\n]*\r?\n/gm, "");
const bundle = await build({
  stdin: {
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {CompliancePicker} from './components/CompliancePicker';
import {COMPLIANCE_CATALOG,savedComplianceOptions} from './lib/compliance-catalog';
const saved=savedComplianceOptions([
{id:'saved-one',key:'music-rights-us',name:'Synthetic rights',version:'1',controlCount:2,isBuiltIn:false},
{id:'saved-two',key:'another-key',name:'Synthetic rights',version:'2',controlCount:3,isBuiltIn:false}]);
function Harness(){const [selected,setSelected]=useState([]);const [one,setOne]=useState('saved-one');const [disabled,setDisabled]=useState(false);
return <main style={{maxWidth:850,margin:'0 auto',padding:16}}>
<h1>Compliance picker: synthetic review</h1>
<CompliancePicker label="Planning options" options={COMPLIANCE_CATALOG} selected={selected} multiple disabled={disabled} onSelect={id=>setSelected(old=>old.includes(id)?old.filter(value=>value!==id):[...old,id])}/>
<output aria-label="Planning selection">{selected.join(',')||'none'}</output>
<CompliancePicker label="Saved frameworks" options={saved} selected={[one]} onSelect={setOne}/>
<output aria-label="Saved selection">{one}</output>
<button type="button" onClick={()=>setDisabled(value=>!value)}>Toggle planning availability</button>
</main>};createRoot(document.getElementById('root')).render(<Harness/>);`,
    resolveDir: webRoot, loader: "tsx",
  },
  bundle: true, write: false, platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
});

test("shared picker preserves selections and identities with keyboard, touch and narrow themes", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const theme of ["light", "dark"]) {
      for (const width of [1280, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390 });
        const page = await context.newPage();
        const errors = [], external = [];
        page.on("pageerror", error => errors.push(String(error)));
        await page.route("**/*", route => {
          if (new URL(route.request().url()).origin !== origin) {
            external.push(route.request().url());
            return route.abort();
          }
          return route.continue();
        });
        try {
          await page.goto(origin);
          await page.addStyleTag({ content: css });
          await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
          assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--line").trim()), theme === "light" ? "#d3dde6" : "#344558");
          await page.addScriptTag({ content: bundle.outputFiles[0].text });
          const planning = page.getByRole("group", { name: "Planning options" });
          const music = planning.getByRole("checkbox", { name: /^Music and performance rights/ });
          await music.focus();
          await page.keyboard.press("Space");
          await expect(music).toBeChecked();
          await expect(page.getByLabel("Planning selection")).toHaveText("music-rights-us");

          await planning.getByRole("searchbox").fill("GDPR");
          await expect(music).toHaveCount(0);
          await expect(planning.getByText("Selected outside this filter: Music and performance rights")).toBeVisible();
          await planning.getByRole("button", { name: "Clear filters" }).click();
          await expect(music).toBeChecked();
          await planning.getByRole("combobox").selectOption("Content & rights");
          await expect(planning.getByRole("checkbox")).toHaveCount(1);
          await planning.getByRole("searchbox").fill("not-a-real-framework");
          await expect(planning.getByText(/No matching options/)).toBeVisible();
          const clear = planning.getByRole("button", { name: "Clear filters" });
          await clear.focus();
          await page.keyboard.press("Enter");
          await expect(music).toBeChecked();
          await expect(planning.getByRole("checkbox", { name: /SOC 2/ })).toHaveCount(1);

          const saved = page.getByRole("group", { name: "Saved frameworks" });
          const versionTwo = saved.getByRole("radio", { name: "Synthetic rights · 2", exact: true });
          if (width === 390) await versionTwo.tap();
          else { await versionTwo.focus(); await page.keyboard.press("Space"); }
          await expect(page.getByLabel("Saved selection")).toHaveText("saved-two");
          await expect(saved.getByRole("radio", { name: "Synthetic rights · 1", exact: true })).not.toBeChecked();
          await saved.getByRole("searchbox").fill("another-key");
          await expect(saved.getByRole("radio")).toHaveCount(1);
          await expect(versionTwo).toBeChecked();
          await saved.getByRole("button", { name: "Clear filters" }).click();

          await page.getByRole("button", { name: "Toggle planning availability" }).click();
          await expect(planning.getByRole("searchbox")).toBeDisabled();
          await expect(music).toBeDisabled();
          await expect(music).toBeChecked();
          await page.getByRole("button", { name: "Toggle planning availability" }).click();
          await expect(music).toBeEnabled();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme}/${width}: horizontal overflow`);
          const box = await planning.boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= width, `${theme}/${width}: picker exceeds viewport`);
          await page.evaluate(() => window.scrollTo(0, 0));
          mkdirSync(proofRoot, { recursive: true });
          await page.screenshot({ path: `${proofRoot}/picker-${theme}-${width}.png`, fullPage: true });
          assert.deepEqual(errors, []);
          assert.deepEqual(external, []);
        } finally { await context.close(); }
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
