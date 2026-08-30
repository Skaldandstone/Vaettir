// Deterministic raster exports of the existing, approved production rune.
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const sharp = createRequire(webRequire.resolve("next/package.json"))("sharp");
const original = await readFile(new URL("../apps/web/app/icon.svg", import.meta.url), "utf8");
const glyph = original.replace(/<rect[^>]*\/>/, "");
const out = new URL("../apps/mobile/assets/", import.meta.url);
await mkdir(out, { recursive: true });
const rune = await sharp(Buffer.from(glyph)).resize(560, 560).png().toBuffer();
for (const [name, background] of [["icon", "#26211B"], ["adaptive-icon", "#00000000"]]) {
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background } })
    .composite([{ input: rune, gravity: "center" }]).png().toFile(fileURLToPath(new URL(`${name}.png`, out)));
}
await sharp(Buffer.from(glyph)).resize(512, 512).png().toFile(fileURLToPath(new URL("splash.png", out)));
console.log("Generated three native PNG assets from the production rune.");
