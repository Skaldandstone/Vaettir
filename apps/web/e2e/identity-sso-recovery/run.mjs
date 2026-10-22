// Actual setup bridge/panel, synthetic SDK and query transport. Not provider acceptance.
/* global window, document, innerWidth, MouseEvent */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(path.join(web, "package.json"));
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const { chromium } = require("@playwright/test");
const output = path.join(web, "../../.local/identity-sso-recovery-ui");
await mkdir(output, { recursive: true });
const bundle = await build({ entryPoints: [path.join(web, "e2e/identity-sso-recovery/fixture.jsx")], outfile: path.join(output, "fixture.js"),
  bundle: true, write: false, jsx: "automatic", platform: "browser", nodePaths: [path.join(web, "node_modules")],
  plugins: [{ name: "synthetic-boundaries", setup(build) {
    build.onResolve({ filter: /^(@clerk\/nextjs|@\/lib\/trpcReact)$/ }, () => ({ path: path.join(web, "e2e/identity-sso-recovery/boundaries.jsx") }));
  } }],
});
const css = (await readFile(path.join(web, "app/globals.css"), "utf8")).replace(/^@import[^\r\n]+\r?\n/, "") + "\n" +
  await readFile(path.join(web, "app/workbench.css"), "utf8") + "\n" + bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles.find(file => file.path.endsWith(".js")).text); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [], blocked = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  blocked.push(route.request().url()); return route.abort();
});
const state = () => page.evaluate(() => window.identityFixture.state());
const configure = patch => page.evaluate(patch => window.identityFixture.configure(patch), patch);
const settle = () => page.evaluate(() => window.identityFixture.settle());
const region = () => page.getByRole("region", { name: "Single sign-on" });
const checked = workspace => region().getByText(`Synthetic ${workspace} SAML connection`, { exact: true }).waitFor();
try {
  for (const theme of ["dark", "light"]) {
    await page.goto(origin);
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({ width: 1280, height: 900 });
    await region().getByRole("button", { name: "Check setup" }).waitFor();
    assert.equal((await state()).calls, 0, "No discovery on mount");
    await region().getByRole("button", { name: "Check setup" }).click(); await checked("alpha");
    assert.equal((await state()).opens.length, 0);
    await configure({ mode: "deferred" });
    await region().getByRole("button", { name: "Open provider setup" }).click();
    await page.waitForFunction(() => window.identityFixture.state().waiting === 1);
    await configure({ workspace: "beta" });
    await region().getByRole("button", { name: "Check setup" }).waitFor();
    assert.equal(await region().getByText(/Synthetic alpha/).count(), 0);
    await settle(); await configure({ mode: "ready" });
    await region().getByRole("button", { name: "Check setup" }).click(); await checked("beta");
    assert.equal((await state()).opens.length, 0, "Old workspace cannot open setup");
    assert.equal((await state()).switches.length, 0);
    await region().getByRole("button", { name: "Open provider setup" }).click();
    await page.waitForFunction(() => window.identityFixture.state().opens.length === 1);
    assert.deepEqual((await state()).opens, ["provider-beta"]);
    assert.deepEqual((await state()).switches, ["provider-beta"]);
    await configure({ subject: "synthetic-other", session: "synthetic-session-two" });
    await region().getByRole("button", { name: "Check setup" }).waitFor();
    assert.equal(await region().getByText(/Synthetic beta/).count(), 0, "Changed account clears status");
    assert.equal((await state()).closes, 1, "Changed account closes old profile");

    // Synchronous duplicate DOM activations, before a React disabled render.
    await configure({ mode: "deferred" });
    const calls = (await state()).calls;
    await region().getByRole("button", { name: "Check setup" }).evaluate(button => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    assert.equal((await state()).calls, calls + 1);
    await configure({ mounted: false });
    await region().waitFor({ state: "detached" });
    await settle();
    await configure({ mounted: true, mode: "error" });
    await region().getByRole("button", { name: "Check setup" }).click();
    await region().getByRole("alert").waitFor();
    assert.equal((await state()).opens.length, 1, "Unmounted request cannot open setup");
    await page.screenshot({ path: path.join(output, `error-${theme}.png`), fullPage: true });
    await configure({ mode: "ready" });
    await region().getByRole("button", { name: "Check setup" }).focus();
    await page.keyboard.press("Enter"); await checked("beta");
    assert.equal(await region().getByRole("alert").count(), 0, "Keyboard retry recovers");
    await page.screenshot({ path: path.join(output, `setup-${theme}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await region().getByText("Setup scope", { exact: true }).focus();
    await page.keyboard.press("Enter");
    assert.equal(await region().locator("details").evaluate(el => el.open), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `setup-narrow-${theme}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ result: "PASS", evidence: "Actual IdentitySsoSetup and IdentitySsoPanel, synthetic SDK/query boundaries only; NOT authenticated/provider/hosted acceptance",
    themes: ["dark", "light"], widths: [1280, 390], checks: ["no mount discovery", "workspace change during delayed open", "current workspace fresh check and explicit open", "account/session reset and profile close", "duplicate synchronous activation guard", "unmount during read", "failure and keyboard retry", "keyboard disclosure", "narrow no overflow"], errors, blocked }, null, 2));
  console.log(`PASS: actual SSO setup recovery in both themes. Evidence: ${output}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  await writeFile(path.join(output, "failure.json"), JSON.stringify({ message: String(error), errors, body: await page.locator("body").innerText() }, null, 2));
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
