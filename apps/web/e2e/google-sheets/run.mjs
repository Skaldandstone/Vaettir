// Actual components + actual pure CSV parser. Provider and transport are local
// synthetic substitutes, not evidence of real Google OAuth or production writes.
/* global document, innerWidth, window */
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(path.join(web, "package.json"));
const viteRequire = createRequire(createRequire(require.resolve("vitest")).resolve("vite"));
const { build } = viteRequire("esbuild"), { chromium } = require("@playwright/test");
const output = path.join(web, "../../.local/google-sheets-import-20261021/ui-with-history");
await mkdir(output, { recursive: true });
const inputs = ["components/GoogleSheetsPrivacyNotice.tsx", "app/google-sheets-privacy/page.tsx", "middleware.ts", "components/Sidebar.tsx", "app/layout.tsx", "lib/auth-return.test.mjs", "components/MigrationWizard.tsx", "components/GoogleSheetsImportSource.tsx", "lib/google-sheets-import.ts", "../api/src/services/csvFieldMapping.ts", "app/globals.css", "app/workbench.css", "e2e/google-sheets/fixture.jsx", "e2e/google-sheets/boundary.jsx", "e2e/google-sheets/run.mjs", "../../pnpm-lock.yaml"];
const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async file => [file, createHash("sha256").update(await readFile(path.join(web, file))).digest("hex")])));
inputs.push("components/HistoricalResultsImport.tsx");
const sourceHashes = await hashes();
const result = await build({
  entryPoints: [path.join(web, "e2e/google-sheets/fixture.jsx")], outfile: "fixture.js", bundle: true, write: false, jsx: "automatic", platform: "browser", nodePaths: [path.join(web, "node_modules")], alias: { "@": web },
  plugins: [{ name: "synthetic-transport", setup(builder) { builder.onResolve({ filter: /\/trpcReact$/ }, () => ({ path: path.join(web, "e2e/google-sheets/boundary.jsx") })); } }],
});
const css = (await readFile(path.join(web, "app/globals.css"), "utf8")).replace(/^@import[^\r\n]+\r?\n/, "") + "\n" + await readFile(path.join(web, "app/workbench.css"), "utf8");
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(result.outputFiles[0].text); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [], network = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("https://**/*", async route => {
  const url = new URL(route.request().url()); network.push(url.origin + url.pathname);
  if (["https://accounts.google.com/gsi/client", "https://apis.google.com/js/api.js"].includes(url.origin + url.pathname)) { await route.fulfill({ contentType: "text/javascript", body: "/* local provider substitute */" }); return; }
  if (url.origin === "https://sheets.googleapis.com") {
    assert.equal(route.request().method(), "GET");
    const flags = new URL(page.url()).searchParams;
    const titleHeader = flags.has("unmappedTitles") || (flags.has("mixedTitles") && url.pathname.includes("Payments")) ? "Mystery heading" : "Title";
    const body = url.pathname.includes("/values/") ? { values: [["Case ID", titleHeader, "Steps", "Expected"], ["case-1", url.pathname.includes("Payments") ? "Payment succeeds" : "Login succeeds", "Submit synthetic form", "Synthetic confirmation"]] } : { spreadsheetId: "synthetic_book", properties: { title: "Synthetic workbook with a descriptive title" }, sheets: ["Login", "Payments"].map((title, sheetId) => ({ properties: { sheetId, title, sheetType: "GRID", gridProperties: { rowCount: 1000, columnCount: 26 } } })) };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) }); return;
  }
  throw new Error(`Unexpected outbound origin: ${url.origin}`);
});
try {
  await page.goto(origin);
  await page.getByRole("button", { name: "Google Sheets Choose a spreadsheet", exact: false }).click();
  await page.getByRole("checkbox", { name: /I approve reading/ }).check();
  await page.getByRole("button", { name: "Load Google connection", exact: true }).click();
  await page.getByRole("button", { name: "Authorize Google and choose a spreadsheet", exact: true }).click();
  await page.getByRole("button", { name: "Read selected tabs and preview", exact: true }).waitFor();
  await page.getByRole("button", { name: "Deselect all", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Read selected tabs and preview", exact: true }).isEnabled(), false);
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page.screenshot({ path: path.join(output, "tabs-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Read selected tabs and preview", exact: true }).click();
  await page.getByRole("button", { name: "Review import scope", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.sheetFixture.commits.length), 0);
  assert.equal(await page.evaluate(() => window.sheetFixture.ai), 0);
  assert.equal(await page.locator(".xlsx-sheet-card").count(), 2);
  await page.screenshot({ path: path.join(output, "mapping-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Switch theme", exact: true }).click();
  await page.screenshot({ path: path.join(output, "mapping-light.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "mapping-narrow.png"), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No horizontal page overflow");
  await page.getByRole("button", { name: "Review import scope", exact: true }).click();
  await page.getByRole("button", { name: "Back to mapping", exact: true }).click();
  assert.equal(await page.locator(".xlsx-sheet-card").count(), 2);
  await page.getByRole("button", { name: "Review import scope", exact: true }).click();
  await page.screenshot({ path: path.join(output, "review-narrow.png"), fullPage: true });
  await page.getByRole("button", { name: "Import selected worksheets", exact: true }).click();
  await page.getByRole("heading", { name: "Import complete", exact: true }).waitFor();
  const commits = await page.evaluate(() => window.sheetFixture.commits);
  assert.equal(commits.length, 1); assert.equal(commits[0].sheets.length, 2);
  assert.equal(JSON.stringify(commits).includes("synthetic-browser-only-token"), false);
  assert.equal(await page.evaluate(() => window.sheetFixture.ai), 0);
  await page.goto(origin);
  await page.getByRole("button", { name: "Google Sheets Choose a spreadsheet", exact: false }).click();
  await page.evaluate(() => { window.sheetFixture.cancel = true; });
  await page.getByRole("checkbox", { name: /I approve reading/ }).check();
  await page.getByRole("button", { name: "Load Google connection", exact: true }).click();
  await page.getByRole("button", { name: "Authorize Google and choose a spreadsheet", exact: true }).click();
  await page.getByRole("alert").getByText(/could not complete the selection/).waitFor();
  assert.equal(await page.evaluate(() => window.sheetFixture.commits.length), 0);
  // Cancellation must invalidate the parent's queued per-tab preview work.
  await page.goto(origin);
  await page.getByRole("button", { name: "Google Sheets Choose a spreadsheet", exact: false }).click();
  await page.getByRole("checkbox", { name: /I approve reading/ }).check();
  await page.getByRole("button", { name: "Load Google connection", exact: true }).click();
  await page.getByRole("button", { name: "Authorize Google and choose a spreadsheet", exact: true }).click();
  await page.evaluate(() => { window.sheetFixture.delayPreview = true; });
  await page.getByRole("button", { name: "Read selected tabs and preview", exact: true }).click();
  await page.waitForFunction(() => typeof window.sheetFixture.resolvePreview === "function");
  await page.getByRole("button", { name: "Cancel Google selection", exact: true }).click();
  await page.evaluate(async () => { window.sheetFixture.resolvePreview(); await new Promise(resolve => window.requestAnimationFrame(resolve)); await new Promise(resolve => window.requestAnimationFrame(resolve)); });
  assert.equal(await page.evaluate(() => window.sheetFixture.previews.length), 1, "No later tab requests after cancel");
  assert.equal(await page.locator(".xlsx-sheet-card").count(), 0, "No late mapping after cancel");
  assert.equal(await page.evaluate(() => window.sheetFixture.commits.length), 0);
  // A selected tab without title mapping blocks review until mapped or explicitly deselected.
  for (const flag of ["mixedTitles", "unmappedTitles"]) {
    await page.goto(`${origin}/?${flag}`);
    await page.getByRole("button", { name: "Google Sheets Choose a spreadsheet", exact: false }).click();
    await page.getByRole("checkbox", { name: /I approve reading/ }).check();
    await page.getByRole("button", { name: "Load Google connection", exact: true }).click();
    await page.getByRole("button", { name: "Authorize Google and choose a spreadsheet", exact: true }).click();
    await page.getByRole("button", { name: "Read selected tabs and preview", exact: true }).click();
    await page.getByText("Selected tabs are never silently left out.", { exact: false }).waitFor();
    const review = page.getByRole("button", { name: "Review import scope", exact: true });
    assert.equal(await review.isEnabled(), false);
    const cards = page.locator(".xlsx-sheet-card");
    assert.equal(await cards.nth(1).locator('input[type="checkbox"]').isEnabled(), true);
    if (flag === "unmappedTitles") {
      await cards.nth(0).getByRole("combobox").first().selectOption("Mystery heading");
      await page.getByText("Selected tabs are never silently left out.", { exact: false }).waitFor();
      assert.equal(await review.isEnabled(), false, "Second unmapped selected tab still blocks review");
    }
    await cards.nth(1).locator('input[type="checkbox"]').uncheck();
    await review.click();
    await page.getByRole("button", { name: "Import selected worksheets", exact: true }).click();
    await page.getByRole("heading", { name: "Import complete", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.sheetFixture.commits[0].sheets.length), 1, "Only explicitly deselected tab is excluded");
  }
  await page.goto(`${origin}/?unconfigured`);
  await page.getByRole("button", { name: "Google Sheets Choose a spreadsheet", exact: false }).click();
  await page.getByText(/awaiting administrator setup/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Load Google connection", exact: true }).count(), 0);
  await page.goto(`${origin}/google-sheets-privacy`);
  await page.getByRole("heading", { name: "Google Sheets import privacy", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Contact us about Google data" }).getAttribute("href"), "mailto:james@skaldandstone.com?subject=Vaettir%20Google%20data%20question");
  await page.getByText(/Revocation stops future authorized Google access/).waitFor();
  await page.screenshot({ path: path.join(output, "privacy-dark.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.screenshot({ path: path.join(output, "privacy-light.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "privacy-narrow.png"), fullPage: true });
  await page.goto(`${origin}/historical`);
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.getByText("Where can I get old results?", { exact: true }).click();
  await page.getByText(/Unmapped result columns are not recoverable/).waitFor();
  const historyFile = page.getByLabel("Historical results file", { exact: true });
  await historyFile.setInputFiles({ name: "old-plan.csv", mimeType: "text/csv", buffer: Buffer.from("ID,Result\nold-1,pass\nold-2,custom\nold-3,") });
  assert.equal(await page.getByLabel("Original historical run date", { exact: true }).inputValue(), "");
  const historyReview = page.getByRole("button", { name: "Review historical results", exact: true });
  assert.equal(await historyReview.isEnabled(), false, "No guessed current date");
  await page.getByLabel("Original historical run date", { exact: true }).fill("2025-01-02");
  await historyReview.click();
  await page.getByRole("heading", { name: "3. Review matches before saving", exact: true }).waitFor();
  const historyCommit = page.getByRole("button", { name: "Import reviewed historical results", exact: true });
  assert.equal(await historyCommit.isEnabled(), false, "Unknown status cannot be committed");
  await page.getByLabel("Meaning of custom", { exact: true }).selectOption("FAIL");
  await page.getByRole("button", { name: "Refresh result review", exact: true }).click();
  await page.getByText("2 ready · 1 without execution · 0 need attention · 1 run date(s)", { exact: true }).waitFor();
  const historicalApproval = page.getByRole("checkbox", { name: /I confirm these dates/ });
  await historicalApproval.check();
  await page.getByLabel("Historical run label", { exact: true }).fill("January results");
  assert.equal(await historicalApproval.isChecked(), false, "Mapping changes clear approval");
  assert.equal(await historyCommit.isEnabled(), false, "Stale review cannot commit");
  await page.getByRole("button", { name: "Refresh result review", exact: true }).click();
  await historicalApproval.check();
  assert.equal(await page.evaluate(() => window.sheetFixture.commits.length), 0);
  await page.screenshot({ path: path.join(output, "history-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Switch theme", exact: true }).click();
  await page.screenshot({ path: path.join(output, "history-light.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(output, "history-narrow.png"), fullPage: true });
  await historyCommit.click();
  await page.getByRole("heading", { name: "Historical results recorded", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "2025-01-02 · 2 results", exact: true }).getAttribute("href"), "/projects/synthetic-project/test-runs#run-synthetic-run");
  const historyPayload = await page.evaluate(() => window.sheetFixture.commits);
  assert.equal(historyPayload.length, 1); assert.equal(historyPayload[0].acknowledgeHistoricalObservation, true);
  assert.equal(historyPayload[0].runDate, "2025-01-02"); assert.equal(historyPayload[0].statusMap.custom, "FAIL");
  assert.equal(await page.evaluate(() => window.sheetFixture.ai), 0);
  // The alternate file path requires an explicit worksheet choice.
  await page.goto(`${origin}/historical`);
  await page.getByLabel("Historical results file", { exact: true }).setInputFiles({ name: "old.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("synthetic transport fixture") });
  await page.getByLabel("Historical worksheet", { exact: true }).selectOption("Old results");
  assert.equal(await page.getByLabel("Original historical run date", { exact: true }).inputValue(), "");
  assert.equal(await page.evaluate(() => window.sheetFixture.commits.length), 0);
  await page.getByLabel("Original historical run date", { exact: true }).fill("2025-01-02");
  await page.getByRole("button", { name: "Review historical results", exact: true }).click();
  await page.getByText("Worksheet row 9", { exact: true }).waitFor();
  await page.getByRole("checkbox", { name: /I confirm these dates/ }).check();
  await page.getByRole("button", { name: "Import reviewed historical results", exact: true }).click();
  await page.getByRole("heading", { name: "Historical results recorded", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.sheetFixture.commits[0].sourceRowNumbers), [5, 9]);
  await page.goto(`${origin}/historical`);
  await page.getByRole("radio", { name: "Google Sheets", exact: true }).check();
  await page.getByRole("checkbox", { name: /I approve reading/ }).check();
  await page.getByRole("button", { name: "Load Google connection", exact: true }).click();
  await page.getByRole("button", { name: "Authorize Google and choose a spreadsheet", exact: true }).click();
  await page.getByRole("button", { name: "Select first 1", exact: true }).click();
  assert.equal(await page.getByRole("group", { name: "Worksheets · 1 selected", exact: true }).getByRole("checkbox").nth(1).isEnabled(), false, "Historical import reads one selected results tab");
  await page.getByRole("button", { name: "Read selected tabs and preview", exact: true }).click();
  await page.getByText("Source: google-sheets:synthetic_book:0", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.sheetFixture.commits.length), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(await hashes(), sourceHashes, "Source inputs stayed unchanged during fixture verification");
  const evidence = { at: new Date().toISOString(), sourceHashes, bundleSha256: createHash("sha256").update(result.outputFiles[0].text).digest("hex"), actualComponents: true, realGoogleAuthorization: false, hostedAcceptance: false, checks: ["two-tab picker, select/deselect", "actual parser auto-mapping and row preview", "zero writes before explicit import", "one multi-tab commit payload without provider credential", "zero AI analysis calls", "back navigation retains mapping", "light, dark and 390px layout", "OAuth cancel fails closed without writes", "cancel during delayed API preview prevents further tabs and late mappings", "missing title blocks both mixed and all-unmapped selections until explicit repair or deselection", "unconfigured provider fails closed", "approved Google data notice renders in both themes and at390px", "historical file columns/date/status review with blank date, stale approval reset and explicit commit", "historical Excel tab selection and run deep link", "historical review renders in both themes at desktop and390px"], errors, network };
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
} catch (error) { await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }); console.error(await page.locator("body").innerText()); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
