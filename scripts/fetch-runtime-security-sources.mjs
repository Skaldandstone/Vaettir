// Public source custody only. Signature, native and final-image admission are
// independent fail-hard build gates; a downloaded archive proves none of them.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const manifest = JSON.parse(await readFile(new URL("./runtime-security-sources.json", import.meta.url), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function sourceDescriptors(value = manifest) {
  assert.equal(value.version, "runtime-security-sources/v1");
  assert.deepEqual(Object.keys(value.components).sort(), ["freetype", "glibc"]);
  const rows = [];
  for (const component of ["glibc", "freetype"]) {
    const entry = value.components[component];
    assert.equal(entry.sourceVersion, component === "glibc" ? "2.41-12+deb13u4" : "2.13.3+dfsg-1+deb13u1");
    assert.match(entry.signer, /^[A-F0-9]{40}$/);
    assert.match(entry.primarySigner, /^[A-F0-9]{40}$/);
    assert.equal(entry.sourceFiles.length, component === "glibc" ? 3 : 7);
    assert.equal(entry.patches.length, component === "glibc" ? 22 : 1);
    const pool = `https://deb.debian.org/debian/pool/main/${component === "glibc" ? "g/glibc" : "f/freetype"}/`;
    for (const file of entry.sourceFiles) {
      assert.match(file.name, /^(?:glibc|freetype)_[A-Za-z0-9.+~-]+\.(?:dsc|(?:orig(?:-ft2docs|-ft2demos)?|debian)\.tar\.xz(?:\.asc)?)$/);
      assert.ok(file.name.startsWith(component + "_"));
      assert.equal(file.url, pool + file.name);
      rows.push({ component, ...file });
    }
    for (const patch of entry.patches) {
      assert.match(patch.commit, /^[a-f0-9]{40}$/);
      assert.equal(patch.name, patch.commit + ".patch");
      assert.equal(patch.url, component === "glibc"
        ? "https://sourceware.org/git/?p=glibc.git;a=patch;h=" + patch.commit
        : "https://gitlab.freedesktop.org/freetype/freetype/-/commit/" + patch.commit + ".patch");
      rows.push({ component, name: patch.name, url: patch.url, sha256: patch.sha256, bytes: patch.bytes });
    }
  }
  assert.equal(rows.length, 33);
  assert.equal(new Set(rows.map(row => row.name)).size, 33);
  assert.equal(new Set(rows.map(row => row.url)).size, 33);
  for (const row of rows) {
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 25000000);
    if (row.name.endsWith(".patch")) assert.ok(row.bytes <= 500000);
  }
  return rows;
}
const pins = sourceDescriptors();

export async function fetchSecuritySource(pin, { fetchImpl = fetch, signal } = {}) {
  const original = pins.find(row => row.name === pin?.name);
  assert.ok(original && JSON.stringify(pin) === JSON.stringify(original), "Source descriptor changed from reviewed manifest");
  const response = await fetchImpl(original.url, {
    redirect: "error",
    // Content-Length must describe the pinned source bytes, not a compressed
    // HTTP representation that fetch transparently decodes before streaming.
    headers: { "accept-encoding": "identity" },
    signal: AbortSignal.any([AbortSignal.timeout(180000), ...(signal ? [signal] : [])]),
  });
  assert.equal(response.status, 200, "Public source transport failed");
  assert.ok(response.body, "Public source body absent");
  const encoding = response.headers.get("content-encoding");
  assert.ok(encoding === null || encoding === "identity", "Public source ignored identity encoding");
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    assert.match(declared, /^[1-9][0-9]{0,8}$/);
    assert.equal(Number(declared), original.bytes, "Source length changed");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= original.bytes, "Source response exceeded pinned length");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, original.bytes, "Source response truncated");
  assert.equal(hash(bytes), original.sha256, "Source checksum changed");
  return bytes;
}

export async function acquireSecuritySources(destination, component) {
  assert.ok(["glibc", "freetype"].includes(component), "Unknown security component");
  const base = resolve(destination);
  await mkdir(base, { recursive: false });
  async function save(name, bytes) {
    const file = await open(join(base, name), "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally { await file.close(); }
    assert.ok((await readFile(join(base, name))).equals(bytes));
  }
  const rows = pins.filter(row => row.component === component);
  await save("source-intent.json", Buffer.from(JSON.stringify({ component, descriptorsSha256: hash(JSON.stringify(rows)), signatureVerified: false, nativeTestsPassed: false }) + "\n"));
  for (const row of rows) await save(row.name, await fetchSecuritySource(row));
  await save("source-manifest.json", Buffer.from(JSON.stringify({ version: manifest.version, component, ...manifest.components[component], signatureVerified: false, nativeTestsPassed: false }, null, 2) + "\n"));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 4, "Supply fresh absolute destination and exact component");
  assert.ok(process.argv[2].startsWith("/"), "Linux build destination must be absolute");
  await acquireSecuritySources(process.argv[2], process.argv[3]);
  console.log("Pinned public security-source bytes acquired; signature/native/image gates remain required.");
}
