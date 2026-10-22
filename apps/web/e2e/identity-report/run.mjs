// Local actual component browser proof, never hosted/provider acceptance.
/* global document, innerWidth, localStorage */
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(path.join(web, "package.json"));
const vite = createRequire(createRequire(require.resolve("vitest")).resolve("vite"));
const { build } = vite("esbuild"), { chromium } = require("@playwright/test");
const output = path.join(web, "../../.local/identity-report-ui"); await mkdir(output, { recursive: true });
const boundary = path.join(web, "e2e/identity-report/boundaries.jsx");
const bundle = await build({ entryPoints: [path.join(web, "e2e/identity-report/fixture.jsx")], outfile: path.join(output, "bundle.js"),
  bundle: true, write: false, jsx: "automatic", platform: "browser", alias: { "@": web }, nodePaths: [path.join(web, "node_modules")],
  plugins: [{ name: "synthetic-transport", setup(builder) {
    builder.onResolve({ filter: /^(@clerk\/nextjs|.*\/trpcReact|\.\/ReportSnapshotCatalog|\.\/ReportDefinitionManager)$/ }, () => ({ path: boundary }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.join(web, "e2e/ui-workbench/link-boundary.tsx") }));
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
try {
  for (const theme of ["dark", "light"]) {
    await page.goto(origin); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.getByRole("button", { name: "Create report", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Report title", { exact: true }).fill(`Synthetic scoped ${theme} report`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Summary (optional)", { exact: true }).fill("Only synthetic records; private review.");
    await page.getByRole("button", { name: "Save definition", exact: true }).click();
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("definition"))).definition.summary, "Only synthetic records; private review.");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Resume local report draft", exact: true }).click();
    assert.equal(await page.getByLabel("Summary (optional)", { exact: true }).inputValue(), "Only synthetic records; private review.");
    await page.getByRole("dialog", { name: "Create stakeholder report" }).evaluate(node => { node.scrollTop = 0; });
    await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: path.join(output, `commentary-${theme}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(output, `commentary-narrow-${theme}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.evaluate(() => localStorage.setItem("offline", "true"));
    await page.getByRole("button", { name: "Capture private preview", exact: true }).click();
    await page.getByRole("dialog", { name: "Create stakeholder report" }).getByText(/Preview response unavailable/).waitFor();
    await page.evaluate(() => localStorage.removeItem("offline"));
    await page.getByRole("button", { name: "Retry same preview", exact: true }).click();
    await page.getByText("Private preview saved. Sharing requires an editor’s approval.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Approve frozen sharing snapshot" }).count(), 0);
    await page.getByRole("dialog", { name: "Create stakeholder report" }).evaluate(node => { node.scrollTop = 0; });
    await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: path.join(output, `private-review-${theme}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(output, `private-review-narrow-${theme}.png`), fullPage: true });
    await page.evaluate(() => localStorage.setItem("revoked", "true")); await page.reload();
    assert.equal(await page.getByRole("button", { name: "Create report", exact: true }).isDisabled(), true);
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ passed: true, hostedAcceptance: false, source: "Actual ReportBuilder/FrozenReport/custom hook; synthetic API, catalog/manager excluded",
    checks: ["scoped non-editor author", "definition save", "Escape and reopen retain commentary", "both themes 1280/390", "unknown capture retry same payload", "sharing unavailable", "revocation disables create"], errors }, null, 2));
  console.log(`PASS actual scoped report UI: ${output}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  await writeFile(path.join(output, "failure.txt"), await page.locator("body").innerText());
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
