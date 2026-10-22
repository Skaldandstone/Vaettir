// Real attachment component and custom-action hook; synthetic query/native read boundaries.
/* global window, document, innerWidth */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(path.join(web, "package.json"));
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild"), { chromium } = require("@playwright/test");
const output = path.join(web, "../../.local/identity-repository-attachment-ui"); await mkdir(output, { recursive: true });
const bundle = await build({ entryPoints: [path.join(web, "e2e/identity-repository-attachment/fixture.jsx")], outfile: path.join(output, "fixture.js"),
  bundle: true, write: false, jsx: "automatic", platform: "browser", alias: { "@": web }, nodePaths: [path.join(web, "node_modules")],
  plugins: [{ name: "synthetic-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(@clerk\/nextjs|.*\/trpcReact|.*\/use-case-field-access)$/ }, () => ({ path: path.join(web, "e2e/identity-repository-attachment/boundaries.jsx") }));
  } }],
});
const css = (await readFile(path.join(web, "app/globals.css"), "utf8")).replace(/^@import[^\r\n]+\r?\n/, "") + "\n" + await readFile(path.join(web, "app/workbench.css"), "utf8");
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(10000);
const errors = [], blocked = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => { if (new URL(route.request().url()).origin === origin) return route.continue(); blocked.push(route.request().url()); return route.abort(); });
const state = () => page.evaluate(() => window.identityFixture.state());
const configure = patch => page.evaluate(patch => window.identityFixture.configure(patch), patch);
const dialog = () => page.getByRole("dialog", { name: "Attach reviewed repositories" });
const open = () => page.getByRole("button", { name: "Review attachments", exact: true }).click();
const choose = async () => { await dialog().getByLabel("Reviewed connection", { exact: true }).selectOption("connection"); await dialog().getByRole("checkbox").first().check(); };
try {
  for (const theme of ["dark", "light"]) {
    await page.goto(origin); await page.evaluate(() => sessionStorage.clear()); await page.reload();
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.setViewportSize({ width: 1280, height: 900 });
    await open(); await choose();
    await configure({ version: "b".repeat(64) });
    assert.equal(await dialog().getByRole("button", { name: "Approve attachment" }).isDisabled(), true);
    await dialog().getByRole("alert").filter({ hasText: "catalogue changed" }).waitFor();
    await configure({ version: "a".repeat(64) });
    assert.equal(await page.getByRole("button", { name: /Connect repo|Open provider|Authorize|Import/ }).count(), 0);
    await page.screenshot({ path: path.join(output, `review-${theme}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog().getByRole("button", { name: "Approve attachment" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `review-narrow-${theme}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => !!document.activeElement.closest("dialog,[role=dialog]")), true);
    await configure({ mode: "after" }); await dialog().getByRole("button", { name: "Approve attachment" }).click();
    await dialog().getByRole("alert").filter({ hasText: "could not be confirmed" }).waitFor();
    const original = (await state()).writes[0];
    await page.keyboard.press("Escape"); await open();
    await dialog().getByRole("status").filter({ hasText: "unresolved" }).waitFor();
    assert.equal(await dialog().getByRole("checkbox").first().isDisabled(), true);
    await configure({ version: "b".repeat(64) });
    assert.equal(await dialog().getByRole("button", { name: "Retry saved attachment" }).isDisabled(), true);
    await configure({ version: "a".repeat(64), expired: true });
    assert.equal(await dialog().getByRole("button", { name: "Retry saved attachment" }).isDisabled(), true);
    await configure({ expired: false, allowed: false });
    await dialog().waitFor({ state: "detached" });
    assert.equal((await state()).writes.length, 1);
    await configure({ allowed: true, mode: "ready" });
    // Retained modal state may reopen on restored permission, but cannot submit automatically.
    await dialog().waitFor(); assert.equal((await state()).writes.length, 1);
    await dialog().getByRole("button", { name: "Retry saved attachment" }).click();
    await dialog().getByRole("status").filter({ hasText: "1 repositories attached" }).waitFor();
    assert.deepEqual((await state()).writes[1], original);
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    await page.keyboard.press("Escape"); await configure({ queryError: true }); await open();
    await dialog().getByRole("alert").filter({ hasText: "catalogue could not" }).waitFor();
    await dialog().getByRole("button", { name: "Reload saved catalogue" }).focus();
    await page.getByRole("tooltip").filter({ hasText: "does not contact" }).waitFor(); await page.keyboard.press("Enter");
    await choose(); await configure({ mode: "deferred" });
    await dialog().getByRole("button", { name: "Approve attachment" }).click();
    await page.waitForFunction(() => window.identityFixture.state().writes.length === 3);
    await configure({ projectId: "other-project", organizationId: "other-org" });
    await page.evaluate(() => window.identityFixture.settle());
    await open(); assert.equal(await dialog().getByRole("status").filter({ hasText: "unresolved" }).count(), 0);
    await page.keyboard.press("Escape");
    await configure({ projectId: "project", organizationId: "org", mode: "ready" }); await open();
    await dialog().getByRole("status").filter({ hasText: "unresolved" }).waitFor();
    await page.screenshot({ path: path.join(output, `retained-${theme}.png`), fullPage: true });
    await page.reload(); await open();
    await dialog().getByRole("status").filter({ hasText: "unresolved" }).waitFor();
    await dialog().getByRole("button", { name: "Retry saved attachment" }).click();
    await dialog().getByRole("status").filter({ hasText: "1 repositories attached" }).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    await page.keyboard.press("Escape");
  }
  await page.goto(origin); await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await open(); await choose();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw Error("Synthetic unavailable storage"); }; });
  await dialog().getByRole("button", { name: "Approve attachment" }).click();
  await dialog().getByRole("alert").filter({ hasText: "storage is unavailable" }).waitFor();
  assert.equal((await state()).writes.length, 0, "No mutation without durable request retention");
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ result: "PASS", evidence: "Actual attachment component and custom-action hook; synthetic native-read/SDK/query transport. NOT provider, hosted or SQL proof.",
    themes: ["dark", "light"], widths: [1280, 390], checks: ["explicit attachment approval", "no provider/setup/import controls", "long labels", "narrow/focus/Escape and keyboard tooltip", "unknown acknowledgement retained across close/reload", "exact request retry", "changed selection version and expiry/revocation denial", "read error keyboard recovery", "in-flight tenant change retention", "no mutation when request storage fails"], errors, blocked }, null, 2));
  console.log(`PASS: reviewed attachment UI. Evidence: ${output}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  await writeFile(path.join(output, "failure.json"), JSON.stringify({ message: String(error), errors, body: await page.locator("body").innerText() }, null, 2)); throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
