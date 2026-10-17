import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const root = fileURLToPath(new URL("./public/", import.meta.url));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp" };
let server, browser, origin;
before(async () => {
  server = createServer((request, reply) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const target = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
    if (!target.startsWith(root)) return reply.writeHead(403).end();
    try { reply.writeHead(200, { "Content-Type": types[path.extname(target)] ?? "text/plain" }).end(readFileSync(target)); }
    catch { reply.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });
for (const width of [1280, 390]) test("marketing assets, navigation and invitation layout at " + width, async () => {
  const p = await browser.newPage({ viewport: { width, height: 900 } });
  p.setDefaultTimeout(5000);
  const failed = [];
  p.on("response", r => { if (r.url().startsWith(origin) && r.status() >= 400) failed.push(r.url()); });
  await p.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
    await p.goto(origin); await p.getByRole("heading", { name: "Vaettir™", exact: true }).waitFor();
    assert.equal(await p.locator('link[rel="canonical"]').getAttribute("href"), "https://vaettir.app/");
    assert.equal(await p.getByRole("link", { name: "All projects", exact: true, includeHidden: true }).getAttribute("href"), "https://skaldandstone.com/#work");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const social = await p.locator('meta[property="og:image"]').getAttribute("content");
    const imagePath = new URL(social).pathname;
    assert.ok(readFileSync(path.join(root, imagePath)).byteLength > 0);
    if (process.env.VAETTIR_MARKETING_SCREENSHOTS) {
      mkdirSync(process.env.VAETTIR_MARKETING_SCREENSHOTS, { recursive: true });
      await p.screenshot({ path: path.join(process.env.VAETTIR_MARKETING_SCREENSHOTS, "marketing-" + width + ".png"), fullPage: true });
    }
    await p.getByRole("link", { name: /Request an invitation/ }).click();
    await p.getByRole("dialog").waitFor();
    assert.equal(await p.getByRole("dialog").getByRole("combobox").inputValue(), "vaettir");
    assert.equal(await p.getByRole("dialog").getByRole("option").count(), 1);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(failed, []);
  } finally { await p.close(); }
});
