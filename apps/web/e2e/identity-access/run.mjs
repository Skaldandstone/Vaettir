// Actual component, synthetic transport. NOT hosted/provider/SQL acceptance.
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
const output = path.join(web, "../../.local/identity-access-ui");
await mkdir(output, { recursive: true });
const bundle = await build({ entryPoints: [path.join(web, "e2e/identity-access/fixture.tsx")], outfile: path.join(output, "fixture.js"), bundle: true, write: false, jsx: "automatic", platform: "browser", nodePaths: [path.join(web, "node_modules")] });
const css = (await readFile(path.join(web, "app/globals.css"), "utf8")).replace(/^@import[^\r\n]+\r?\n/, "") + "\n" + await readFile(path.join(web, "app/workbench.css"), "utf8") + "\n" + bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
try {
  await page.goto(origin);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.getByRole("button", { name: "Roles", exact: true }).click();
    await page.screenshot({ path: path.join(output, `roles-${theme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Edit Test author", exact: true }).click();
    await page.getByRole("checkbox", { name: "View results", exact: true }).check();
    await page.screenshot({ path: path.join(output, `role-editor-${theme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Apply to draft" }).click();
    if (theme === "dark") {
      await page.evaluate(() => localStorage.setItem("fail-save", "true"));
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Synthetic save failed" }).waitFor();
      await page.evaluate(() => localStorage.removeItem("fail-save"));
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Draft saved" }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Edit Test author", exact: true }).click();
      assert.equal(await page.getByRole("checkbox", { name: "View results", exact: true }).isChecked(), true);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    await page.getByRole("button", { name: "Groups", exact: true }).click();
    await page.getByRole("button", { name: "Edit Release engineering", exact: true }).click();
    await page.getByRole("checkbox", { name: "Release reviewer", exact: true }).check();
    await page.getByRole("checkbox", { name: /Synthetic author/ }).check();
    await page.screenshot({ path: path.join(output, `group-editor-${theme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Apply to draft" }).click();
    if (await page.getByRole("button", { name: "Save draft", exact: true }).isEnabled()) {
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Draft saved" }).waitFor();
    }
  }
  await page.reload();
  await page.getByRole("button", { name: "Groups", exact: true }).click();
  await page.getByRole("button", { name: "Edit Release engineering", exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: /Synthetic author/ }).isChecked(), true);
  assert.equal(await page.getByRole("checkbox", { name: "Release reviewer", exact: true }).isChecked(), true);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Apply to draft" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `group-narrow-${theme}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No page overflow");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"],dialog')), true, "Dialog retains keyboard focus");
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Roles", exact: true }).click();
  await page.getByRole("button", { name: "New role", exact: true }).click();
  await page.getByLabel("Role name", { exact: true }).fill("Test author");
  await page.getByRole("checkbox", { name: "View cases", exact: true }).check();
  await page.getByRole("button", { name: "Apply to draft" }).click();
  await page.getByRole("dialog").getByRole("alert").filter({ hasText: "unique role" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit Test author", exact: true }).click();
  await page.getByRole("checkbox", { name: "View plans", exact: true }).check();
  await page.getByRole("button", { name: "Apply to draft" }).click();
  await page.getByRole("link", { name: "Synthetic navigation" }).click();
  await page.getByRole("dialog", { name: "Leave unsaved changes?" }).waitFor();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(new URL(page.url()).pathname, "/");
  await page.evaluate(() => { const current = JSON.parse(localStorage.getItem("identity-fixture")); current.revision++; localStorage.setItem("identity-fixture", JSON.stringify(current)); });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "another session" }).waitFor();
  await page.getByRole("button", { name: "Reload saved version", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reload", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Loaded the saved draft" }).waitFor();
  await page.getByRole("button", { name: "Edit Test author", exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: "View plans", exact: true }).isChecked(), false, "Conflict recovery loads the saved version, not the conflicting edit");
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ result: "PASS", evidence: "Actual local component, synthetic persistence only", themes: ["dark", "light"], viewportWidths: [1280, 390], checks: ["role edit/save/reopen", "group members/roles/scope reopen", "save failure recovery", "duplicate name validation in dialog", "unsaved navigation guard", "revision conflict and explicit reload", "dialog keyboard containment", "narrow overflow"], errors }, null, 2));
  console.log(`PASS: identity editor local two-theme workflow. Evidence: ${output}`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
