// Read-only real-component footer diagnostic. No save mutation is invoked.
/* global document, window, innerHeight */
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
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
  const geometry = () => page.locator("summary").filter({ hasText: "Clear or unset value" }).evaluate(node => {
    const rect = node.getBoundingClientRect(), footer = document.querySelector(".case-editor-footer").getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { summary: { top: rect.top, bottom: rect.bottom }, footer: { top: footer.top, bottom: footer.bottom },
      viewportHeight: innerHeight, scrollY: window.scrollY, focused: document.activeElement === node,
      centerReachable: hit === node || node.contains(hit), overlap: rect.top < footer.bottom && rect.bottom > footer.top };
  });
  for (const theme of ["dark", "light"]) for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`${origin}/new`);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.getByLabel("Title", { exact: true }).fill("Synthetic footer diagnostic");
    const metadata = page.getByRole("textbox", { name: "Evidence reference", exact: true });
    await metadata.fill("Synthetic evidence");
    await page.getByRole("button", { name: "+ Add step", exact: true }).click();
    await page.getByLabel("Step 1: Test Step", { exact: true }).fill("Verify isolated manual author access");
    await page.getByRole("button", { name: "Collapse all steps", exact: true }).click();
    await metadata.focus(); await page.keyboard.press("Tab");
    const keyboard = await geometry();
    await page.screenshot({ path: path.join(output, `keyboard-${theme}-${width}.png`) });
    await page.keyboard.press("Enter");
    await expect(page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Clear or unset value" }) })).toHaveAttribute("open", "");
    const expanded = await geometry();
    await page.keyboard.press("Enter");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => (await geometry()).centerReachable).toBe(true);
    const bottom = await geometry();
    await page.screenshot({ path: path.join(output, `bottom-${theme}-${width}.png`) });
    await page.locator("summary").filter({ hasText: "Clear or unset value" }).click();
    assert.equal(await page.evaluate(() => window.fixture.snapshot().calls.length), 0);
    observations.push({ theme, width, keyboard, expanded, bottom, keyboardToggle: true, bottomClick: true, saveMutations: 0 });
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), hashes, observations, errors, hostedAcceptance: false }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ output, observations }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
