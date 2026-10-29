/* global HTMLButtonElement */
/* global document, window */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const { build } = createRequire(
  createRequire(require.resolve("vitest")).resolve("vite"),
)("esbuild");

test("short actions preserve native form/ref/keyboard/touch behavior and dismissible viewport-safe help", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: root + "apps/web",
      loader: "tsx",
      contents: `
    import React,{useRef,useEffect} from 'react';import{createRoot}from'react-dom/client';import{ActionButton}from'./components/ui/ActionButton';
    window.events=[];function App(){const ref=useRef(null);useEffect(()=>{window.button=ref.current},[]);return <main style={{padding:20}}><form onSubmit={e=>{e.preventDefault();window.events.push('submit')}}>
    <p id="context">Original project only.</p><ActionButton ref={ref} className="btn-primary" aria-describedby="context" tooltip="Recover the original request receipt" onClick={()=>window.events.push('click')} onKeyDown={e=>window.events.push(e.key)}>Retry</ActionButton>
    <ActionButton type="button" className="btn-secondary" tooltip="Export this report" onClick={()=>window.events.push('export')}>Export</ActionButton>
    <ActionButton type="button" disabled tooltip="Delete the reviewed selection" onClick={()=>window.events.push('delete')}>Delete</ActionButton>
    </form><div style={{marginTop:450,display:'flex',justifyContent:'end'}}><ActionButton type="button" tooltip="View the saved report and its original source details">Details</ActionButton></div></main>}
    createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const css = readFileSync(root + "apps/web/app/globals.css", "utf8").replace(
    /^@import[^\n]+/gm,
    "",
  );
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      `<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 700 },
      hasTouch: true,
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const retry = page.getByRole("button", {
      name: "Retry: Recover the original request receipt",
      exact: true,
    });
    assert.equal(await retry.innerText(), "Retry");
    assert.equal(
      await page.evaluate(() => window.button instanceof HTMLButtonElement),
      true,
    );
    await retry.focus();
    const tip = page.getByRole("tooltip");
    await tip.waitFor();
    assert.match(await retry.getAttribute("aria-describedby"), /^context .+/);
    assert.equal(await tip.innerText(), "Recover the original request receipt");
    await page.keyboard.press("Escape");
    assert.equal(await tip.count(), 0);
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.events), [
      "Escape",
      "Enter",
      "click",
      "submit",
    ]);
    const exported = page.getByRole("button", {
      name: "Export this report",
      exact: true,
    });
    await exported.tap();
    assert.equal(await tip.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.events.slice(-1)), [
      "export",
    ]);
    await exported.blur();
    await exported.hover();
    await tip.waitFor();
    await tip.hover();
    await page.waitForTimeout(250);
    assert.equal(await tip.count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await tip.count(), 0);
    await page.getByRole("button", { name: /View the saved report/ }).focus();
    await tip.waitFor();
    const bounds = await tip.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= 390 &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= 700,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Delete the reviewed selection" })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page.evaluate(() => window.events.includes("delete")),
      false,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
