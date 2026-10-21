// Actual server render + browser hydration using Next's App Router React pair.
// Synthetic UI only: no Clerk, API, database, credentials or external requests.
/* global document, window -- evaluated only in the isolated fixture browser */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(path.join(web, "package.json"));
const viteRequire = createRequire(createRequire(require.resolve("vitest")).resolve("vite"));
const { build } = viteRequire("esbuild"), { chromium } = require("@playwright/test");
const output = path.resolve(process.env.VAETTIR_DIALOG_HYDRATION_EVIDENCE
  ?? path.join(web, "../../.local/dialog-hydration"));
await mkdir(output, { recursive: true });
const alias = {
  "react": path.dirname(require.resolve("next/dist/compiled/react/package.json")),
  "react-dom": path.dirname(require.resolve("next/dist/compiled/react-dom/package.json")),
  "react-dom/server": require.resolve("next/dist/compiled/react-dom/server.node"),
};
const options = { bundle: true, jsx: "automatic", write: false, alias,
  nodePaths: [path.join(web, "node_modules")], define: { "process.env.NODE_ENV": '"development"' } };
const resolveDir = path.join(web, "e2e/dialog-hydration");
const ssr = await build({ ...options, platform: "node", format: "cjs", stdin: {
  resolveDir, sourcefile: "server.jsx", loader: "jsx",
  contents: 'import{renderToString}from"react-dom/server";import{HydrationFixture}from"./fixture.jsx";export const html=renderToString(<HydrationFixture/>);',
} });
const serverPath = path.join(output, "server.cjs");
await writeFile(serverPath, ssr.outputFiles[0].text);
const { html } = require(serverPath);
assert.ok(html.includes("Open retained draft"));
assert.ok(!html.includes("<dialog"), "Server renders no portal");
const client = await build({ ...options, platform: "browser", stdin: {
  resolveDir, sourcefile: "client.jsx", loader: "jsx",
  contents: 'import{hydrateRoot}from"react-dom/client";import{HydrationFixture}from"./fixture.jsx";window.dialogHydrationErrors=[];hydrateRoot(document.getElementById("root"),<HydrationFixture/>,{onRecoverableError:error=>window.dialogHydrationErrors.push(error.message)});',
} });
const server = createServer((request, response) => {
  if (request.url === "/bundle.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(client.outputFiles[0].text);
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><body><div id="root">${html}</div><script src="/bundle.js"></script></body></html>`);
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [], consoleErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
try {
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector("dialog input[data-owner]"));
  assert.deepEqual(await page.evaluate(() => window.dialogHydrationErrors), [], "No recovered hydration failure");
  assert.deepEqual(pageErrors, []);
  assert.equal(await page.locator("dialog").count(), 1);
  assert.equal(await page.locator("dialog").evaluate(element => element.hidden && element.inert), true);
  const opener = page.getByRole("button", { name: "Open retained draft", exact: true });
  await opener.click();
  const input = page.getByRole("textbox", { name: "Retained draft", exact: true });
  await input.fill("Synthetic owned draft");
  const owner = await input.getAttribute("data-owner");
  await page.keyboard.press("Escape");
  assert.equal(await opener.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.locator("dialog").evaluate(element => element.hidden && element.inert), true);
  await opener.click();
  assert.equal(await input.inputValue(), "Synthetic owned draft");
  assert.equal(await input.getAttribute("data-owner"), owner, "Same mounted owner after close/reopen");
  await page.keyboard.press("Escape");
  const result = { passed: true, actualServerRender: true, actualBrowserHydration: true,
    reactVersion: require("next/dist/compiled/react").version,
    serverHtmlSha256: createHash("sha256").update(html).digest("hex"),
    hydrationErrors: await page.evaluate(() => window.dialogHydrationErrors), pageErrors,
    hiddenPortalInert: true, draftAndOwnerRetained: true, escapeRestoresFocus: true,
    externalRequestsAllowed: false, hostedAcceptance: false };
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  const result = { passed: false, error: error.message,
    hydrationErrors: await page.evaluate(() => window.dialogHydrationErrors ?? []), pageErrors, consoleErrors };
  await writeFile(path.join(output, "failure.json"), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
