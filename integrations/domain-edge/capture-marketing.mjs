// Capture the deployed public page, never the concurrent dirty Studio tree.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("./public/", import.meta.url));
const source = "https://skaldandstone.com";
const recorded = [];
const seen = new Set();
async function capture(asset, output = asset.slice(1)) {
  if (seen.has(asset)) return;
  if (!/^\/(?:vaettir\/|assets\/|favicon\.svg$)/.test(asset) || asset.includes("..") || asset.includes("?")) throw new Error("Unexpected asset path");
  seen.add(asset);
  const response = await fetch(source + asset, { redirect: "error" });
  if (!response.ok) throw new Error("Public asset unavailable: " + asset);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 4_000_000) throw new Error("Public asset too large");
  const target = path.join(root, output);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  recorded.push({ source: source + asset, output, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  if (asset.endsWith(".css")) {
    const css = new TextDecoder().decode(bytes);
    for (const match of css.matchAll(/url\(["']?([^)"']+)["']?\)/g)) {
      const ref = new URL(match[1], source + asset);
      if (ref.origin === source) await capture(ref.pathname);
    }
  }
}
await capture("/vaettir/", "index.html");
let html = await readFile(path.join(root, "index.html"), "utf8");
for (const match of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
  if (/^\/(assets\/|vaettir\/.*\.(css|webp|png|svg)|favicon\.svg)/.test(match[1])) await capture(match[1]);
}
for (const match of html.matchAll(/content="https:\/\/skaldandstone\.com(\/vaettir\/[^"]+\.(?:webp|png|svg))"/g))
  await capture(match[1]);
html = html.replaceAll("https://skaldandstone.com/vaettir/", "https://vaettir.app/")
  .replaceAll('href="/#work"', 'href="https://skaldandstone.com/#work"')
  .replaceAll('href="/#contact"', 'href="https://skaldandstone.com/#contact"')
  .replaceAll('href="/privacy/"', 'href="https://skaldandstone.com/privacy/"')
  .replaceAll('href="/accessibility/"', 'href="https://skaldandstone.com/accessibility/"')
  .replaceAll('href="/"', 'href="https://skaldandstone.com/"')
  .replace("<title>Vaettir™ - Skald &amp; Stone™</title>", "<title>Vaettir™ | Quality intelligence</title>");
html = html.replace(/content="https:\/\/vaettir\.app\/([^"/]+\.(?:webp|png|svg))"/g, 'content="https://vaettir.app/vaettir/$1"');
await writeFile(path.join(root, "index.html"), html);
// Keep legal links and invitation processing with their existing data controller.
const script = path.join(root, "assets/access-request.js");
await writeFile(script, (await readFile(script, "utf8"))
  .replaceAll('href="/privacy/"', 'href="https://skaldandstone.com/privacy/"')
  .replace(/const products = \[[\s\S]*?\n  \];/, 'const products = [["vaettir", "Vaettir"]];'));
await writeFile(path.join(root, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: https://vaettir.app/sitemap.xml\n");
await writeFile(path.join(root, "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://vaettir.app/</loc></url></urlset>\n');
await writeFile(new URL("./marketing-source.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), source, assets: recorded,
  finalHomepageSha256: createHash("sha256").update(html).digest("hex") }, null, 2) + "\n");
console.log(JSON.stringify({ capturedAssets: recorded.length }));
