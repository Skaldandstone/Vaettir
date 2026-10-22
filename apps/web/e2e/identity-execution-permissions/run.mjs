// Actual notice/hooks only; synthetic transport, not hosted/run/provider acceptance.
/* global document, innerWidth, window */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(path.join(web, "package.json"));
const vite = createRequire(createRequire(require.resolve("vitest")).resolve("vite"));
const { build } = vite("esbuild"), { chromium } = require("@playwright/test");
const output = path.join(web, "../../.local/identity-execution-permissions-ui"); await mkdir(output, { recursive: true });
const boundary = path.join(web, "e2e/identity-execution-permissions/boundaries.jsx");
const bundle = await build({ entryPoints: [path.join(web, "e2e/identity-execution-permissions/fixture.jsx")], outfile: path.join(output, "bundle.js"),
  bundle: true, write: false, jsx: "automatic", platform: "browser", alias: { "@": web }, nodePaths: [path.join(web, "node_modules")],
  plugins: [{ name: "synthetic-transport", setup(builder) {
    builder.onResolve({ filter: /^(@clerk\/nextjs|.*\/trpcReact)$/ }, () => ({ path: boundary }));
  } }] });
const css = (await readFile(path.join(web, "app/globals.css"), "utf8")).replace(/^@import[^\r\n]+\r?\n/, "") + "\n" + await readFile(path.join(web, "app/workbench.css"), "utf8");
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(10000);
const errors = []; page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
const availability = () => page.getByLabel("Manual execution availability");
try {
  for (const theme of ["dark", "light"]) {
    await page.goto(origin); await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.getByRole("alert", { name: "Execution permissions" }).waitFor();
    assert.equal(await availability().textContent(), "Unavailable");
    assert.equal(await page.evaluate(() => window.identityFixture.state().calls), 0);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(output, `failure-${theme}-${width}.png`), fullPage: true });
    }
    const draft = page.getByLabel("Retained fixture draft"); await draft.fill("Preserve unsaved work");
    const retry = page.getByRole("button", { name: "Retry permissions", exact: true });
    await retry.focus(); await page.keyboard.press("Enter");
    assert.equal(await retry.isDisabled(), true);
    assert.equal(await availability().textContent(), "Unavailable");
    assert.equal(await page.evaluate(() => window.identityFixture.state().calls), 1);
    await page.evaluate(() => { window.identityFixture.configure({ next: "reject" }); window.identityFixture.settle(); });
    await page.getByRole("alert", { name: "Execution permissions" }).waitFor();
    await retry.click();
    await page.evaluate(() => { window.identityFixture.configure({ next: "allowed" }); window.identityFixture.settle(); });
    await page.waitForFunction(() => document.querySelector('output')?.textContent === "Allowed");
    assert.equal(await draft.inputValue(), "Preserve unsaved work");
    assert.equal(await page.getByLabel("Execution permissions", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.identityFixture.state().calls), 2);
    await page.screenshot({ path: path.join(output, `recovered-${theme}.png`), fullPage: true });
    await page.evaluate(() => window.identityFixture.configure({ mode: "error", next: "denied" }));
    await retry.click(); await page.evaluate(() => window.identityFixture.settle());
    await page.waitForFunction(() => !document.querySelector('[aria-label="Execution permissions"]'));
    assert.equal(await availability().textContent(), "Unavailable");
    await page.evaluate(() => window.identityFixture.configure({ mode: "paused" }));
    await page.getByRole("status", { name: "Execution permissions" }).waitFor();
    assert.equal(await availability().textContent(), "Unavailable");
    await page.evaluate(() => window.identityFixture.configure({ mode: "error", role: "EDITOR" }));
    await page.waitForFunction(() => document.querySelector('output')?.textContent === "Allowed");
    assert.equal(await page.getByLabel("Execution permissions", { exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  const sources = {};
  for (const file of ["components/ExecutionPermissionNotice.tsx", "lib/use-scoped-manual-execution-access.ts", "lib/use-project-custom-actions.ts", "lib/use-manual-execution-access.ts"])
    sources[file] = createHash("sha256").update(await readFile(path.join(web, file))).digest("hex");
  await writeFile(path.join(output, "result.json"), JSON.stringify({ passed: true, hostedAcceptance: false, providerAcceptance: false, sources,
    scope: "Actual recovery notice and actual permission hooks; synthetic queries/auth only. Run screens, mutations and provider lifecycle not covered.",
    checks: ["failed query is nonactionable", "explicit keyboard retry", "pending read disables duplicate retry", "rejected retry recoverable", "successful grant read", "successful denial stays denied", "paused read", "native editor independent", "retained fixture draft", "dark/light 1280/390"], errors }, null, 2));
  console.log(`PASS scoped permission recovery UI: ${output}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  await writeFile(path.join(output, "failure.txt"), await page.locator("body").innerText()); throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
