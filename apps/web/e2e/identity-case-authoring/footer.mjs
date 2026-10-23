// Read-only real-component footer diagnostic. No save mutation is invoked.
/* global document, window, innerHeight, getComputedStyle */
import { createRequire } from "node:module";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { admitOutput } from "./output.mjs";
const output = await admitOutput(process.argv.slice(2));
const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url))), root = path.resolve(web, "../..");
const require = createRequire(path.join(web, "package.json"));
const vite = createRequire(createRequire(require.resolve("vitest")).resolve("vite"));
const { build } = vite("esbuild"), { chromium, expect } = require("@playwright/test");
const bundle = await build({ entryPoints: [path.join(web, "e2e/identity-case-authoring/fixture.jsx")], outfile: path.join(output, "bundle.js"),
  bundle: true, write: false, metafile: true, jsx: "automatic", platform: "browser", alias: { "@": web }, nodePaths: [path.join(web, "node_modules")],
  plugins: [{ name: "synthetic-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(@clerk\/nextjs|.*\/trpcReact|next\/navigation)$/ }, () => ({ path: path.join(web, "e2e/identity-case-authoring/boundaries.jsx") }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.join(web, "e2e/ui-workbench/link-boundary.tsx") }));
  } }] });
const sourceFiles = Object.keys(bundle.metafile.inputs).map(file => path.resolve(file)).filter(file => file.startsWith(root) && !file.includes("node_modules"));
sourceFiles.push(path.join(web, "app/globals.css"), path.join(web, "app/workbench.css"), fileURLToPath(import.meta.url), fileURLToPath(new URL("./output.mjs", import.meta.url)));
const hashes = Object.fromEntries(await Promise.all([...new Set(sourceFiles)].sort().map(async file => [path.relative(root, file).replaceAll("\\", "/"), createHash("sha256").update(await readFile(file)).digest("hex")])));
const css = (await readFile(path.join(web, "app/globals.css"), "utf8")).replace(/^@import[^\r\n]+\r?\n/, "") + "\n" + await readFile(path.join(web, "app/workbench.css"), "utf8");
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const observations = [], errors = [];
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : (errors.push("Off-origin request blocked"), route.abort()));
  const summary = page.locator("summary").filter({ hasText: "Clear or unset value" });
  const geometry = (target = summary) => target.evaluate(node => {
    const rect = node.getBoundingClientRect(), footer = document.querySelector(".case-editor-footer").getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { summary: { top: rect.top, bottom: rect.bottom }, footer: { top: footer.top, bottom: footer.bottom },
      viewportHeight: innerHeight, scrollY: window.scrollY, focused: document.activeElement === node,
      centerReachable: hit === node || node.contains(hit), overlap: rect.top < footer.bottom && rect.bottom > footer.top };
  });
  const assertReachable = value => {
    assert.equal(value.focused, true, "Expected keyboard focus on inspected control");
    assert.equal(value.centerReachable, true, "Focused control center must receive pointer events");
    assert.equal(value.overlap, false, "Focused control must not intersect footer");
    assert.ok(value.summary.top >= 0 && value.summary.bottom <= value.viewportHeight, "Focused control must be entirely visible");
  };
  for (const role of ["custom", "native"]) for (const theme of ["dark", "light"]) for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`${origin}/new${role === "native" ? "?native=1" : ""}`);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.getByLabel("Title", { exact: true }).fill("Synthetic footer diagnostic");
    const metadata = page.getByRole("textbox", { name: "Evidence reference", exact: true });
    await metadata.fill("Synthetic evidence");
    await page.getByRole("button", { name: "+ Add step", exact: true }).click();
    await page.getByLabel("Step 1: Test Step", { exact: true }).fill("Verify isolated manual author access");
    await page.getByRole("button", { name: "Collapse all steps", exact: true }).click();
    await metadata.focus(); await page.keyboard.press("Tab");
    const keyboard = await geometry();
    assertReachable(keyboard);
    await page.screenshot({ path: path.join(output, `keyboard-${role}-${theme}-${width}.png`) });
    await page.keyboard.press("Enter");
    await expect(page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Clear or unset value" }) })).toHaveAttribute("open", "");
    const expanded = await geometry();
    assertReachable(expanded);
    const expandedControls = [];
    for (const name of ["Set NULL explicitly", "Remove value (unset)"]) {
      await page.keyboard.press("Tab");
      const control = page.getByRole("button", { name, exact: true });
      const position = await geometry(control); assertReachable(position);
      await control.click({ trial: true }); // Reachability only: never clear fixture values.
      expandedControls.push({ name, ...position });
    }
    await page.screenshot({ path: path.join(output, `expanded-${role}-${theme}-${width}.png`) });
    await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => (await geometry()).centerReachable).toBe(true);
    const bottom = await geometry();
    await page.screenshot({ path: path.join(output, `bottom-${role}-${theme}-${width}.png`) });
    await page.locator("summary").filter({ hasText: "Clear or unset value" }).click();
    await page.keyboard.press("Enter"); // Close again before testing initial scroll positions.
    const scrollStarts = [];
    for (const start of ["top", "mid", "end"]) {
      await page.getByLabel("Title", { exact: true }).focus();
      const initialScrollY = await page.evaluate(start => {
        const end = Math.max(0, document.documentElement.scrollHeight - innerHeight);
        window.scrollTo(0, start === "top" ? 0 : start === "mid" ? end / 2 : end);
        return window.scrollY;
      }, start);
      await metadata.focus(); await page.keyboard.press("Tab");
      const position = await geometry(); assertReachable(position);
      scrollStarts.push({ start, initialScrollY, ...position });
    }
    await expect(metadata).toHaveValue("Synthetic evidence");
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Synthetic footer diagnostic");
    const save = page.getByRole("button", { name: "Create test case", exact: true });
    await save.focus(); await save.click({ trial: true });
    const footerPosition = await page.locator(".case-editor-footer").evaluate(node => getComputedStyle(node).position);
    assert.equal(footerPosition, width === 1280 ? "sticky" : "static");
    assert.equal(await page.evaluate(() => window.fixture.snapshot().calls.length), 0);
    observations.push({ role, theme, width, keyboard, expanded, expandedControls, scrollStarts, bottom, footerPosition, keyboardToggle: true, bottomClick: true, saveMutations: 0 });
  }
  assert.deepEqual(errors, []);
  const screenshotHashes = Object.fromEntries(await Promise.all((await readdir(output)).filter(file => file.endsWith(".png")).map(async file => [file, createHash("sha256").update(await readFile(path.join(output, file))).digest("hex")])));
  await writeFile(path.join(output, "result.json"), JSON.stringify({ passed: true, sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), hashes, screenshotHashes, observations, errors, hostedAcceptance: false, providerAcceptance: false }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ output, combinations: observations.length, screenshots: Object.keys(screenshotHashes).length, passed: true }));
} catch (error) {
  await writeFile(path.join(output, "result.json"), JSON.stringify({ passed: false, hashes, observations, errors, error: String(error), hostedAcceptance: false }, null, 2), { flag: "wx" });
  throw error;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
