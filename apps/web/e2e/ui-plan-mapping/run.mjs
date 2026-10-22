// Local real-component rendering with synthetic transport. NOT hosted acceptance.
/* global document, innerWidth -- evaluated only in the local fixture browser */
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(path.join(web, "package.json"));
const viteRequire = createRequire(createRequire(require.resolve("vitest")).resolve("vite"));
const { build } = viteRequire("esbuild"), { chromium } = require("@playwright/test");
const identityOnly = process.argv.includes("--identity-mapping-only");
const manualOnly = process.argv.includes("--identity-plan-only");
const output = path.join(web, manualOnly ? "../../.local/identity-manual-plan-ui" : identityOnly ? "../../.local/identity-manual-mapping-ui" : "../../.local/ui-plan-mapping-20261020");
await mkdir(output, { recursive: true });
const boundary = path.join(web, "e2e/ui-plan-mapping/boundaries.jsx");
const result = await build({
  entryPoints: [path.join(web, "e2e/ui-plan-mapping/fixture.jsx")], outfile: path.join(output, "fixture.js"), bundle: true, write: false, jsx: "automatic", platform: "browser",
  nodePaths: [path.join(web, "node_modules")], alias: { "@": web },
  plugins: [{ name: "synthetic-transport-only", setup(builder) {
    builder.onLoad({ filter: /test-plans[\\/]page\.tsx$/ }, async ({ path: sourcePath }) => ({ contents: await readFile(sourcePath, "utf8") + "\nexport { ManualPlanCreate };", loader: "tsx" }));
    builder.onResolve({ filter: /^(next\/navigation|@clerk\/nextjs|.*\/trpcReact|\.\/CaseCustomFields)$/ }, () => ({ path: boundary }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.join(web, "e2e/ui-workbench/link-boundary.tsx") }));
  } }],
});
const css = (await readFile(path.join(web, "app/globals.css"), "utf8")).replace(/^@import[^\r\n]+\r?\n/, "") + "\n" + await readFile(path.join(web, "app/workbench.css"), "utf8");
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(result.outputFiles[0].text); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
const visible = locator => locator.waitFor({ state: "visible" });
try {
  if (manualOnly) {
    for (const theme of ["dark", "light"]) {
      await page.goto(`${origin}/?screen=manual`);
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; localStorage.removeItem("plan-revoked"); }, theme);
      await page.getByLabel("Plan name", { exact: true }).fill(`Scoped synthetic ${theme} plan`);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(output, `plan-${theme}.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(output, `plan-narrow-${theme}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.getByRole("button", { name: "Create test plan", exact: true }).click();
      await visible(page.getByText("Test plan created.", { exact: true }));
      assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("manual-plan-created"))).name, `Scoped synthetic ${theme} plan`);
      await page.evaluate(() => localStorage.setItem("plan-revoked", "true"));
      await page.reload();
      await visible(page.getByRole("button", { name: "Refresh access", exact: true }));
      assert.equal(await page.getByLabel("Plan name", { exact: true }).count(), 0);
      await page.evaluate(() => localStorage.removeItem("plan-revoked"));
      await page.getByRole("button", { name: "Refresh access", exact: true }).click();
      await visible(page.getByLabel("Plan name", { exact: true }));
    }
    assert.deepEqual(errors, []);
    await writeFile(path.join(output, "evidence.json"), JSON.stringify({ source: "actual ManualPlanCreate and scoped action hook with synthetic transport", hostedAcceptance: false,
      checks: ["custom plans.write without native editor", "explicit create acknowledgement", "revoked permission hidden", "refresh restores current access", "dark/light 1280/390"], errors }, null, 2));
    console.log("PASS: scoped manual plan creation UI; not hosted/provider acceptance");
  } else if (identityOnly) {
    for (const theme of ["dark", "light"]) {
      await page.goto(`${origin}/?screen=architecture&identity`);
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; localStorage.removeItem("mapping-revoked"); }, theme);
      await page.getByLabel("Diagram", { exact: true }).setInputFiles({ name: "synthetic-checkout.puml", mimeType: "text/plain", buffer: Buffer.from("@startuml\ncomponent CheckoutAPI\n@enduml") });
      await page.getByRole("button", { name: "Inspect diagram", exact: true }).click();
      await visible(page.getByRole("heading", { name: "Components & interactions" }));
      assert.equal(await page.getByRole("button", { name: "Save architecture version", exact: true }).count(), 0);
      await page.locator(".architecture-ai-options summary").click();
      assert.equal(await page.getByRole("button", { name: "Analyze architecture", exact: true }).isDisabled(), true);
      await page.locator(".architecture-ai-options summary").click();
      await page.getByRole("button", { name: "Existing-test mappings", exact: true }).click();
      await page.getByLabel("Test case", { exact: true }).selectOption("case-checkout");
      await page.getByLabel("Component or interaction", { exact: true }).selectOption("checkout");
      await page.getByRole("button", { name: "Link test", exact: true }).click();
      await visible(page.getByText("Test link saved. No AI credits used.", { exact: true }));
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(output, `manual-${theme}.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(output, `manual-narrow-${theme}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.evaluate(() => localStorage.setItem("mapping-revoked", "true"));
      await page.reload();
      await page.getByLabel("Diagram", { exact: true }).setInputFiles({ name: "synthetic-checkout.puml", mimeType: "text/plain", buffer: Buffer.from("@startuml\ncomponent CheckoutAPI\n@enduml") });
      await page.getByRole("button", { name: "Inspect diagram", exact: true }).click();
      await page.getByRole("button", { name: "Existing-test mappings", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Link test", exact: true }).count(), 0);
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    assert.deepEqual(errors, []);
    await writeFile(path.join(output, "evidence.json"), JSON.stringify({ source: "actual ArchitectureWorkbench with synthetic transport", hostedAcceptance: false,
      checks: ["scoped manual mapping with canSpend=false", "source retained", "AI and standalone document save unavailable", "permission revocation hides mapping controls", "dark/light 1280/390"], errors }, null, 2));
    console.log("PASS: scoped manual architecture mapping UI; not hosted/provider acceptance");
  } else {
  await page.goto(`${origin}/?controlled`);
  await page.getByRole("button", { name: "Configure cases", exact: true }).click();
  await visible(page.getByRole("heading", { name: "Available tests" }));
  await page.getByRole("checkbox", { name: /SYN-01/ }).check();
  await page.getByRole("checkbox", { name: /SYN-02/ }).check();
  await page.getByRole("button", { name: "Move test 2 up", exact: true }).click();
  assert.match(await page.locator(".plan-selected-cases li").first().innerText(), /SYN-02/);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Desktop Chrome · synthetic");
  await page.getByRole("textbox", { name: "Platform", exact: true }).fill("Web");
  await page.getByRole("textbox", { name: "Environment", exact: true }).fill("Synthetic verification");
  await page.screenshot({ path: path.join(output, "plan-selection-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Switch theme" }).click();
  await page.getByRole("button", { name: "Configure cases", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "Desktop Chrome · synthetic");
  await page.screenshot({ path: path.join(output, "plan-selection-light.png"), fullPage: true });
  await page.getByRole("checkbox", { name: "I reviewed the selected tests and configurations." }).check();
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await visible(page.getByText("Saving plan…", { exact: true }));
  assert.equal(await page.getByRole("button", { name: "Retry save", exact: true }).count(), 0, "No retry offered while the response is in flight");
  // Close/reopen keeps the exact pending request, without a second mutation.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Configure cases", exact: true }).click();
  await visible(page.getByText("Saving plan…", { exact: true }));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Lose synthetic response", exact: true }).click();
  await page.getByRole("button", { name: "Configure cases", exact: true }).click();
  await visible(page.getByRole("button", { name: "Retry save", exact: true }));
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await visible(page.getByText("Saving plan…", { exact: true }));
  // Transport-only control is outside native modality. Dispatch its synthetic
  // response, not a user action through the inert background.
  await page.getByRole("button", { name: "Deliver synthetic response", exact: true }).dispatchEvent("click");
  await visible(page.getByText("Plan selection and configurations saved.", { exact: true }));
  await page.getByRole("button", { name: "Reload saved selection", exact: true }).click();
  await visible(page.getByRole("heading", { name: "Available tests" }));
  assert.match(await page.locator(".plan-selected-cases li").first().innerText(), /SYN-02/);
  assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "Desktop Chrome · synthetic");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "plan-selection-narrow.png"), fullPage: true });
  assert.ok(await page.locator(".modal-panel").evaluate(el => el.scrollWidth <= el.clientWidth + 1), "Plan dialog has no horizontal overflow");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByText("Synthetic transport evidence", { exact: true }).click();
  const evidence = JSON.parse(await page.getByTestId("transport-evidence").innerText());
  assert.equal(evidence.saveCount, 1);
  assert.equal(evidence.sentRequests.length, 2);
  assert.deepEqual(evidence.sentRequests[0], evidence.sentRequests[1], "Unknown outcome retries the identical request");
  assert.deepEqual(evidence.template.testCaseIds, ["case-retry", "case-checkout"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/?screen=architecture&controlled`);
  await page.getByLabel("Diagram", { exact: true }).setInputFiles({ name: "synthetic-checkout.puml", mimeType: "text/plain", buffer: Buffer.from("@startuml\ncomponent CheckoutAPI\n@enduml") });
  await page.getByRole("button", { name: "Inspect diagram", exact: true }).click();
  await visible(page.getByRole("heading", { name: "Components & interactions" }));
  await page.getByRole("button", { name: "Existing-test mappings", exact: true }).click();
  await page.getByLabel("Test case", { exact: true }).selectOption("case-checkout");
  await page.getByLabel("Component or interaction", { exact: true }).selectOption("checkout");
  await page.getByRole("button", { name: "Link test", exact: true }).click();
  await visible(page.getByText("Saving test link…", { exact: true }));
  assert.equal(await page.getByRole("button", { name: "Retry link save", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Lose synthetic response", exact: true }).click();
  await page.getByRole("button", { name: "Retry link save", exact: true }).click();
  await visible(page.getByText("Saving test link…", { exact: true }));
  await page.getByRole("button", { name: "Deliver synthetic response", exact: true }).click();
  await visible(page.getByText("Test link saved. No AI credits used.", { exact: true }));
  await page.screenshot({ path: path.join(output, "architecture-mapping-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Switch theme" }).click();
  await page.screenshot({ path: path.join(output, "architecture-mapping-light.png"), fullPage: true });
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page.screenshot({ path: path.join(output, "architecture-map-light.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Existing-test mappings", exact: true }).click();
  await page.screenshot({ path: path.join(output, "architecture-mapping-narrow.png"), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Architecture screen has no horizontal overflow");
  await page.getByText("Synthetic transport evidence", { exact: true }).click();
  const mappings = JSON.parse(await page.getByTestId("transport-evidence").innerText());
  assert.equal(mappings.decisions.length, 1); assert.equal(mappings.savedSource, true);
  assert.equal(mappings.sentRequests.length, 2);
  assert.deepEqual(mappings.sentRequests[0], mappings.sentRequests[1], "Manual mapping retry preserves source, scope and request identity");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/?screen=projects`);
  await visible(page.getByRole("heading", { name: "Projects", exact: true }));
  assert.equal(await page.locator(".project-card").count(), 4);
  await page.screenshot({ path: path.join(output, "projects-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Edit Checkout platform", exact: true }).focus();
  await visible(page.getByRole("tooltip"));
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Find a project" }).fill("inventory");
  assert.equal(await page.locator(".project-card").count(), 1);
  await page.getByRole("textbox", { name: "Find a project" }).fill("");
  await page.getByRole("button", { name: "Switch theme" }).click();
  await page.screenshot({ path: path.join(output, "projects-light.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "projects-narrow.png"), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Project selector has no horizontal overflow");
  await page.goto(`${origin}/?screen=repositories`);
  await visible(page.getByText("No connected repositories in this batch.", { exact: true }));
  assert.equal(await page.getByRole("heading", { name: "Repository releases", exact: true }).count(), 1);
  const refreshButton = page.getByRole("button", { name: "Refresh repository releases", exact: true });
  await refreshButton.click();
  assert.ok((await refreshButton.boundingBox()).width < 300, "Refresh stays content-sized on narrow screens");
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.ok((await refreshButton.boundingBox()).width < 300, "Refresh stays content-sized on wide screens");
  assert.deepEqual(errors, []);
  const report = { source: "actual PlanTemplateEditor, ArchitectureWorkbench, ProjectsPage and RepositoryReleaseDiscovery with synthetic transport", hostedAcceptance: false, checks: ["case selection, reordering, exact save and reload", "close/reopen retains draft and in-flight request", "pending versus lost-response display, identical retry and one commit", "two themes and 390px layout", "manual mapping retains link and source without AI", "compact project selector, search and keyboard tooltips", "single embedded release heading and content-sized refresh"], errors };
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  }
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  console.error(JSON.stringify({ errors, body: await page.locator("body").innerText() }));
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
