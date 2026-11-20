import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const recipe = JSON.parse(await readFile(new URL("./glibc-runtime-sources.json", import.meta.url), "utf8"));
assert.equal(recipe.version, "2.43-7");
assert.equal(recipe.origin, "https://deb.debian.org/debian/pool/main/g/glibc/");
const destination = resolve(process.argv[2]);
await mkdir(destination, { recursive: true });
for (const file of recipe.files) {
  assert.match(file.name, /^glibc_2\.43(?:-7)?\.(?:dsc|orig\.tar\.xz|debian\.tar\.xz)$/);
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(file.maxBytes) && file.maxBytes > 0 && file.maxBytes <= 25000000);
  const response = await fetch(recipe.origin + file.name, { redirect: "error", signal: AbortSignal.timeout(90000) });
  assert.ok(response.ok && response.body, `glibc source download failed (${response.status}): ${file.name}`);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    assert.ok(bytes <= file.maxBytes, "glibc source exceeded its size bound");
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks);
  assert.equal(createHash("sha256").update(content).digest("hex"), file.sha256);
  await writeFile(join(destination, file.name), content, { flag: "wx" });
}
await writeFile(join(destination, "source-manifest.json"), JSON.stringify(recipe, null, 2) + "\n", { flag: "wx" });
