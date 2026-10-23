// Real New/Edit pages, form and permission hooks; synthetic transports only.
/* global document, innerWidth, window */
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const root = path.resolve(web, "../.."), require = createRequire(path.join(web, "package.json"));
const vite = createRequire(createRequire(require.resolve("vitest")).resolve("vite"));
const { build } = vite("esbuild"), { chromium, expect } = require("@playwright/test");
const output = path.join(root, ".local/identity-case-authoring-ui");
await mkdir(output, { recursive: true });
const boundary = path.join(web, "e2e/identity-case-authoring/boundaries.jsx");
const bundle = await build({ entryPoints: [path.join(web, "e2e/identity-case-authoring/fixture.jsx")], outfile: path.join(output, "bundle.js"),
  bundle: true, write: false, metafile: true, jsx: "automatic", platform: "browser", alias: { "@": web }, nodePaths: [path.join(web, "node_modules")],
  plugins: [{ name: "synthetic-transports-only", setup(builder) {
    builder.onResolve({ filter: /^(@clerk\/nextjs|.*\/trpcReact|next\/navigation)$/ }, () => ({ path: boundary }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.join(web, "e2e/ui-workbench/link-boundary.tsx") }));
  } }] });
const sourceFiles = Object.keys(bundle.metafile.inputs).map(file => path.resolve(file)).filter(file => file.startsWith(root) && !file.includes("node_modules"));
sourceFiles.push(path.join(web, "app/globals.css"), path.join(web, "app/workbench.css"), fileURLToPath(import.meta.url));
const hashes = Object.fromEntries(await Promise.all([...new Set(sourceFiles)].sort().map(async file => [path.relative(root, file).replaceAll("\\", "/"), createHash("sha256").update(await readFile(file)).digest("hex")])));
const css = (await readFile(path.join(web, "app/globals.css"), "utf8")).replace(/^@import[^\r\n]+\r?\n/, "") + "\n" + await readFile(path.join(web, "app/workbench.css"), "utf8");
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const errors = [], blockedRequests = [], checks = [];
try {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : (blockedRequests.push(route.request().url()), route.abort()));
  const patch = next => page.evaluate(next => window.fixture.patch(next), next);
  const snapshot = () => page.evaluate(() => window.fixture.snapshot());
  for (const theme of ["dark", "light"]) for (const mode of ["new", "edit"]) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/${mode}`);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const save = page.getByRole("button", { name: mode === "new" ? "Create test case" : "Save changes", exact: true });
    const title = page.getByLabel("Title", { exact: true });
    const evidence = page.getByRole("textbox", { name: "Evidence reference", exact: true });
    await title.fill(`Synthetic ${mode} ${theme} draft`);
    await evidence.fill(""); await expect(save).toBeDisabled();
    assert.equal((await snapshot()).calls.length, 0);
    await evidence.fill("Reviewed synthetic evidence"); await expect(save).toBeEnabled();
    checks.push(`${mode}/${theme}: required custom field blocks submission; cases.write permits manual authoring`);
    const help = page.getByRole("button", { name: "About procedure steps", exact: true });
    await help.focus(); await expect(page.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("Escape"); await expect(page.getByRole("tooltip")).toHaveCount(0);
    if (mode === "new") await page.getByRole("button", { name: "+ Add step", exact: true }).click();
    else await page.getByRole("button", { name: "Expand all steps", exact: true }).click();
    await page.getByLabel("Step 1: Test Step", { exact: true }).fill("Verify isolated manual author access");
    await page.getByLabel("Step 1: Expected Result", { exact: true }).fill("Only the authorized synthetic case is saved");
    await page.getByRole("button", { name: "Collapse all steps", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByLabel("Step 1: Test Step", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: /01 Verify isolated manual author access/ })).toHaveAttribute("aria-expanded", "false");
    checks.push(`${mode}/${theme}: keyboard help/Escape and compact action-title collapse retain populated steps`);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${mode}/${theme}/${width}: overflow`);
      await page.screenshot({ path: path.join(output, `${mode}-${theme}-${width}.png`), fullPage: true });
    }
    for (const [name, changed, restored] of [
      ["revoked", { permissions: [] }, { permissions: ["cases.write"] }],
      ["stale actions", { fetching: true }, { fetching: false }],
      ["wrong action project", { actionProjectId: "other-project" }, { actionProjectId: null }],
      ["wrong action organization", { actionOrganizationId: "other-org" }, { actionOrganizationId: null }],
      ["wrong action subject", { actionSubject: "other-actor" }, { actionSubject: null }],
      ["stale field read", { fieldFetching: true }, { fieldFetching: false }],
      ["field read failure", { fieldError: true }, { fieldError: false }],
      ["field edit revoked", { fieldEditable: false }, { fieldEditable: true }],
      ["field organization changed", { fieldOrganizationId: "other-org" }, { fieldOrganizationId: null }],
    ]) {
      await patch(changed); await expect(save).toBeDisabled();
      // Even a programmatic native click must not result in a transport attempt.
      await save.evaluate(node => node.click()); assert.equal((await snapshot()).calls.length, 0, name);
      await patch(restored); await expect(save).toBeEnabled();
      await expect(title).toHaveValue(`Synthetic ${mode} ${theme} draft`);
      await expect(evidence).toHaveValue("Reviewed synthetic evidence");
      checks.push(`${mode}/${theme}: ${name} denies before transport and retains draft`);
    }
    await page.evaluate(() => window.fixture.liveSession("synthetic-actor", "other-session"));
    await expect(save).toBeDisabled(); assert.equal((await snapshot()).calls.length, 0);
    await page.evaluate(() => window.fixture.liveSession("synthetic-actor", "synthetic-session")); await expect(save).toBeEnabled();
    await page.evaluate(() => window.fixture.session("other-actor", "other-session"));
    await expect(save).toBeDisabled(); await expect(evidence).toBeHidden(); assert.equal((await snapshot()).calls.length, 0);
    await page.evaluate(() => window.fixture.session("synthetic-actor", "synthetic-session")); await expect(save).toBeEnabled();
    await expect(evidence).toHaveValue("Reviewed synthetic evidence");
    checks.push(`${mode}/${theme}: live session mismatch and account switch cannot submit original draft`);
    await patch({ error: true }); await expect(save).toBeDisabled();
    const retry = page.getByRole("button", { name: mode === "new" ? "Retry project access" : "Retry access and case", exact: true });
    await retry.focus(); await page.keyboard.press("Enter"); await expect(save).toBeEnabled();
    await patch({ failSave: true }); await save.click(); await page.getByRole("alert").filter({ hasText: "Synthetic save failed" }).waitFor();
    await expect(title).toHaveValue(`Synthetic ${mode} ${theme} draft`); await expect(evidence).toHaveValue("Reviewed synthetic evidence");
    assert.equal((await snapshot()).navigations.length, 0);
    await patch({ failSave: false }); await save.focus(); await page.keyboard.press("Enter");
    await expect.poll(async () => (await snapshot()).navigations.length).toBe(1);
    const result = await snapshot(); assert.equal(result.calls.length, 2);
    assert.deepEqual(result.calls[0], result.calls[1]);
    assert.equal(result.calls[1].name, mode === "new" ? "create" : "update");
    assert.deepEqual(result.calls[1].input.customFields, { evidence: "Reviewed synthetic evidence" });
    assert.equal(result.calls[1].input.expectedFieldSchemaHash, "schema-r1");
    assert.equal(result.calls[1].input.expectedCustomFieldRevision, "values-r1");
    assert.equal(result.calls[1].input.steps[0].action, "Verify isolated manual author access");
    assert.equal(result.calls[1].input.steps[0].expectedResult, "Only the authorized synthetic case is saved");
    if (mode === "edit") { assert.equal(result.calls[1].input.expectedCaseRevision, "case-r1"); assert.equal(result.calls[1].input.expectedStepRevision, "steps-r1"); }
    else assert.equal(result.calls[1].input.projectId, "synthetic-project");
    assert.equal(result.navigations[0], "/projects/synthetic-project/test-cases/synthetic-case");
    assert.ok(result.reads.some(read => read.name === "fields" && read.input.authoringAction === "cases.write"));
    checks.push(`${mode}/${theme}: keyboard retry/save, recoverable failure, exact metadata/revision payload and original navigation`);
    await page.goto(`${origin}/${mode}`);
    await title.fill("Original project private draft"); await evidence.fill("Original project private metadata");
    await patch({ projectId: "other-project" });
    await expect(title).toHaveValue(mode === "new" ? "" : "Synthetic retained case");
    await expect(evidence).toHaveValue(mode === "new" ? "" : "Original synthetic evidence");
    assert.equal((await snapshot()).calls.length, 0);
    checks.push(`${mode}/${theme}: project navigation remounts editor without carrying original project draft`);
    await page.goto(`${origin}/${mode}`); await patch({ role: "EDITOR", permissions: [] });
    await title.fill("Native editor synthetic draft"); await evidence.fill("Native editor evidence");
    await expect(save).toBeEnabled(); assert.equal((await snapshot()).calls.length, 0);
    checks.push(`${mode}/${theme}: native editor permission remains available without custom actions`);
    await page.goto(`${origin}/${mode}?denied=1`);
    await page.getByText(/Case-author access and a full seat are required/).waitFor();
    assert.equal(await save.count(), 0); assert.equal((await snapshot()).calls.length, 0);
    checks.push(`${mode}/${theme}: server-denied light-seat response exposes no authoring form`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(blockedRequests, []);
  const screenshotHashes = {};
  for (const theme of ["dark", "light"]) for (const mode of ["new", "edit"]) for (const width of [1280, 390]) {
    const file = `${mode}-${theme}-${width}.png`;
    screenshotHashes[file] = createHash("sha256").update(await readFile(path.join(output, file))).digest("hex");
  }
  await writeFile(path.join(output, "result.json"), JSON.stringify({ passed: true, capturedAt: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    hashes, screenshotHashes, hostedAcceptance: false, providerAcceptance: false, transport: "Synthetic Clerk, tRPC and Next navigation; actual pages/form/hooks", checks, errors, blockedRequests }, null, 2));
  console.log(`PASS ${checks.length} actual case-authoring UI checks: ${output}`);
} catch (error) {
  await writeFile(path.join(output, "result.json"), JSON.stringify({ passed: false, capturedAt: new Date().toISOString(), hashes, checks, errors, error: String(error), hostedAcceptance: false, providerAcceptance: false }, null, 2));
  if (page) { await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }); await writeFile(path.join(output, "failure.txt"), await page.locator("body").innerText()); }
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
