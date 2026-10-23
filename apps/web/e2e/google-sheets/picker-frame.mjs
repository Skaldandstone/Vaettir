// Real browser/document referrer and message-boundary regression. Google is a
// local substitute; this never represents real Google authorization acceptance.
/* global window, document, parent, location */
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
const output = path.join(web, "../../.local/google-sheets-picker-20261021/browser");
await mkdir(output, { recursive: true });
const inputs = ["lib/google-picker-frame.ts", "lib/google-picker-document.ts", "lib/google-sheets-import.ts", "app/connections/google-sheets/picker/route.ts", "middleware.ts", "e2e/google-sheets/picker-frame.mjs"];
const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async file => [file, createHash("sha256").update(await readFile(path.join(web, file))).digest("hex")])));
const sourceHashes = await hashes();
const entry = await build({ stdin: { contents: 'import {openGooglePickerFrame} from "./lib/google-picker-frame"; window.fixture={results:[],open:(expires)=>openGooglePickerFrame({token:"synthetic-browser-only-token",apiKey:"synthetic-public-key",appId:"123456789",expires:expires??Date.now()+60000},r=>window.fixture.results.push(r))};', resolveDir: web }, bundle: true, write: false, platform: "browser" });
const routeBuild = await build({ entryPoints: [path.join(web, "app/connections/google-sheets/picker/route.ts")], bundle: true, write: false, platform: "node", format: "esm", alias: { "@": web } });
const { GET } = await import("data:text/javascript;base64," + Buffer.from(routeBuild.outputFiles[0].text).toString("base64"));
const response = GET();
assert.equal(response.headers.get("referrer-policy"), "origin");
assert.equal(response.headers.get("cache-control"), "no-store");
assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'self'/);
const html = await response.text();
assert.ok(!html.includes("synthetic-browser-only-token"));
assert.ok(!html.includes("project-private-path"));
const requests = [], providerRequests = [], errors = [], checks = [];
const provider = createServer((req, res) => { providerRequests.push({ url: req.url, referrer: req.headers.referer ?? null }); res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Synthetic provider</title>"); });
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
const providerOrigin = `http://127.0.0.1:${provider.address().port}`;
const server = createServer((req, res) => {
  requests.push({ url: req.url, referrer: req.headers.referer ?? null });
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.url === "/connections/google-sheets/picker") {
    response.headers.forEach((value, key) => res.setHeader(key, value));
    // Simulate the production edge's stronger inherited HTTP policy.
    res.setHeader("Referrer-Policy", "no-referrer"); res.end(html);
  } else if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(entry.outputFiles[0].text); }
  else if (req.url === "/other-frame") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><script>window.received=0;addEventListener("message",e=>{if(e.data.action==="initialize")window.received++});parent.postMessage({channel:"vaettir-google-picker-v1",action:"ready"},location.origin);parent.postMessage({channel:"vaettir-google-picker-v1",action:"picked",docs:[{id:"foreign",mimeType:"application/vnd.google-apps.spreadsheet"}]},location.origin)</script>'); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><button id="start">Synthetic parent</button><script src="/bundle.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let scripts = 0, malformed = false;
page.on("pageerror", error => errors.push(error.message));
await page.route("https://**/*", async route => {
  assert.equal(route.request().url(), "https://apis.google.com/js/api.js");
  assert.equal(route.request().headers().referer, origin + "/");
  scripts++;
  await route.fulfill({ contentType: "text/javascript", body: `window.gapi={load:(_name,o)=>o.callback()};window.google={picker:{DocsView:class{setMimeTypes(){return this}},PickerBuilder:class{addView(){return this}setOAuthToken(token){if(token!=="synthetic-browser-only-token")throw Error("Wrong fixture token");return this}setDeveloperKey(){return this}setAppId(){return this}setOrigin(origin){if(origin!==location.origin)throw Error("Wrong Picker origin");return this}setCallback(callback){this.callback=callback;return this}build(){let frame;return{dispose(){frame?.remove()},setVisible:()=>{frame=document.createElement("iframe");frame.src=${JSON.stringify(providerOrigin + "/picker")};document.body.append(frame);const button=document.createElement("button");button.textContent="Select synthetic spreadsheet";button.onclick=()=>this.callback({action:"picked",docs:[{id:${JSON.stringify(malformed ? "bad/id" : "synthetic_book")},mimeType:"application/vnd.google-apps.spreadsheet"}]});document.body.append(button)}}}}}};` });
});
const helper = () => page.frameLocator('iframe[title="Choose a Google spreadsheet"]');
let scenario = 0;
const reset = async () => { await page.goto(origin + "/project-private-path?opaque=private-query&fixture=" + (++scenario) + "#private-fragment"); };
try {
  await reset();
  await page.evaluate(() => { window.fixture.handle = window.fixture.open(); });
  await helper().getByRole("button", { name: "Select synthetic spreadsheet" }).waitFor();
  await page.evaluate(url => { const frame = document.createElement("iframe"); frame.src = url + "/parent-probe"; document.body.append(frame); }, providerOrigin);
  await page.frameLocator(`iframe[src="${providerOrigin}/parent-probe"]`).locator("body").waitFor({ state: "attached" });
  assert.equal(providerRequests.find(r => r.url === "/picker").referrer, origin + "/");
  assert.equal(providerRequests.find(r => r.url === "/parent-probe").referrer, null);
  assert.equal(requests.find(r => r.url === "/connections/google-sheets/picker").referrer, null);
  assert.equal(await page.locator('meta[name="referrer"]').count(), 0);
  checks.push("HTTP no-referrer parent preserved; only fixed helper sends origin to script and cross-origin Picker frame");
  await page.screenshot({ path: path.join(output, "isolated-picker.png"), fullPage: true });
  await page.evaluate(() => { const frame = document.createElement("iframe"); frame.src = "/other-frame"; document.body.append(frame); });
  await page.frameLocator('iframe[src="/other-frame"]').locator("body").waitFor({ state: "attached" });
  assert.equal(await page.frames().find(f => f.url().endsWith("/other-frame")).evaluate(() => window.received), 0);
  assert.deepEqual(await page.evaluate(() => window.fixture.results), []);
  checks.push("same-origin wrong-source ready/picked messages ignored; credential never sent to other frame");
  await helper().getByRole("button", { name: "Select synthetic spreadsheet" }).click();
  await page.locator('iframe[title="Choose a Google spreadsheet"]').waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.fixture.results), [{ action: "picked", docs: [{ id: "synthetic_book", mimeType: "application/vnd.google-apps.spreadsheet" }] }]);
  checks.push("selected file payload validated; helper removed before parent callback");
  await reset();
  await page.evaluate(() => { window.fixture.handle = window.fixture.open(); });
  await helper().getByRole("button", { name: "Select synthetic spreadsheet" }).waitFor();
  await helper().getByRole("button", { name: "Cancel Google selection" }).click();
  await page.locator('iframe[title="Choose a Google spreadsheet"]').waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.fixture.results), [{ action: "cancel" }]);
  checks.push("cancel removes frame and browser credential context");
  await reset();
  await page.evaluate(() => { window.fixture.handle = window.fixture.open(); });
  await helper().getByRole("button", { name: "Select synthetic spreadsheet" }).waitFor();
  await page.evaluate(() => { window.fixture.handle.dispose(); });
  assert.equal(await page.locator('iframe[title="Choose a Google spreadsheet"]').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.fixture.results), []);
  checks.push("unmount disposal removes frame/listener without a late selection callback");
  await reset(); malformed = true;
  await page.evaluate(() => { window.fixture.open(); });
  await helper().getByRole("button", { name: "Select synthetic spreadsheet" }).click();
  await page.locator('iframe[title="Choose a Google spreadsheet"]').waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.fixture.results), [{ action: "error" }]);
  checks.push("malformed file identifier fails closed");
  await reset(); malformed = false;
  const beforeExpired = scripts;
  await page.evaluate(() => { window.fixture.open(Date.now() - 1); });
  await page.waitForFunction(() => window.fixture.results.length === 1);
  assert.deepEqual(await page.evaluate(() => window.fixture.results), [{ action: "error" }]);
  assert.equal(scripts, beforeExpired);
  checks.push("expired parent credential never initializes Google");
  await reset();
  await page.evaluate(() => { const frame = document.createElement("iframe"); frame.title = "Uninitialized helper"; frame.src = "/connections/google-sheets/picker"; document.body.append(frame); });
  await page.frameLocator('iframe[title="Uninitialized helper"]').getByRole("button", { name: "Cancel Google selection" }).waitFor();
  const uninitialized = page.frames().find(f => f.url() === origin + "/connections/google-sheets/picker");
  const beforeUntrusted = scripts;
  await uninitialized.evaluate(() => {
    const data = { channel: "vaettir-google-picker-v1", action: "initialize", token: "synthetic-browser-only-token", apiKey: "synthetic-public-key", appId: "123456789", expires: Date.now() + 60000 };
    window.dispatchEvent(new MessageEvent("message", { data, origin: "https://untrusted.invalid", source: parent }));
    window.dispatchEvent(new MessageEvent("message", { data, origin: location.origin, source: window }));
  });
  assert.equal(scripts, beforeUntrusted);
  await page.evaluate(() => {
    const target = document.querySelector('iframe[title="Uninitialized helper"]').contentWindow;
    window.childRejected = false;
    window.addEventListener("message", event => { if (event.source === target && event.origin === location.origin && event.data?.action === "error") window.childRejected = true; });
    target.postMessage({ channel: "vaettir-google-picker-v1", action: "initialize", token: "synthetic-browser-only-token", apiKey: "synthetic-public-key", appId: "123456789", expires: Date.now() - 1 }, location.origin);
  });
  await page.waitForFunction(() => window.childRejected);
  assert.equal(scripts, beforeUntrusted);
  checks.push("child rejects wrong-origin, wrong-source and expired initialization; no provider load before handshake");
  await reset();
  await page.evaluate(() => { window.fixture.open(Date.now() + 1500); });
  await helper().getByRole("button", { name: "Select synthetic spreadsheet" }).waitFor();
  await page.locator('iframe[title="Choose a Google spreadsheet"]').waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.fixture.results), [{ action: "error" }]);
  checks.push("credential expiry removes helper and fails closed");
  await page.goto(origin + "/connections/google-sheets/picker");
  await page.getByText("Open Google Sheets import from your Vaettir project.", { exact: true }).waitFor();
  checks.push("standalone helper does not authorize or load Google");
  const wire = JSON.stringify([...requests, ...providerRequests]);
  assert.ok(!wire.includes("synthetic-browser-only-token"));
  assert.ok(!providerRequests.some(r => r.referrer?.includes("project-private-path") || r.referrer?.includes("private-query")));
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  assert.deepEqual(errors, []);
  assert.deepEqual(await hashes(), sourceHashes);
  const evidence = { at: new Date().toISOString(), sourceHashes, checks, actualBrowserReferrerHeaders: true, googleSimulated: true, realGoogleAuthorization: false, hostedAcceptance: false, errors };
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
} catch (error) { await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }); throw error; }
finally { await browser.close(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => provider.close(resolve))]); }
