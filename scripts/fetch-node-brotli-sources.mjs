import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const ALLOWED_INPUTS = new Set([
  "https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz",
  "https://deb.debian.org/debian/pool/main/b/brotli/brotli_1.1.0-2.dsc",
  "https://deb.debian.org/debian/pool/main/b/brotli/brotli_1.1.0.orig.tar.gz",
  "https://deb.debian.org/debian/pool/main/b/brotli/brotli_1.1.0-2.debian.tar.xz",
  "https://github.com/google/brotli/commit/da9806362874b9bd4b552a3af360b5d6347beb12.patch",
]);
const CORPUS_BASE =
  "https://raw.githubusercontent.com/google/brotli/ed738e842d2fbdf2d6459e39267a633c4a9b2f5d/tests/testdata/";
const corpus = JSON.parse(
  await readFile(
    new URL("./brotli-runtime-test-corpus.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(corpus.commit, "ed738e842d2fbdf2d6459e39267a633c4a9b2f5d");
assert.equal(corpus.files.length, 67);
assert.equal(
  corpus.files.reduce((n, f) => n + f.bytes, 0),
  15474193,
);
for (const f of corpus.files) {
  assert.match(f.name, /^[A-Za-z0-9_.-]+$/);
  assert.ok(
    Number.isSafeInteger(f.bytes) && f.bytes >= 0 && f.bytes <= 16000000,
  );
  ALLOWED_INPUTS.add(CORPUS_BASE + f.name);
}

export async function fetchPinnedInput(url, pin, { fetchImpl = fetch } = {}) {
  const u = new URL(url);
  assert.equal(u.protocol, "https:");
  assert.equal(u.username, "");
  assert.equal(u.password, "");
  assert.ok(ALLOWED_INPUTS.has(u.href), "Unapproved source URL");
  assert.match(pin.sha256, /^[a-f0-9]{64}$/);
  assert.ok(
    Number.isSafeInteger(pin.bytes) &&
      pin.bytes >= 0 &&
      pin.bytes <= 60000000 &&
      (pin.bytes > 0 || u.href === CORPUS_BASE + "empty"),
  );
  const r = await fetchImpl(u.href, {
    redirect: "error",
    headers: { "Accept-Encoding": "identity" },
    signal: AbortSignal.timeout(90000),
  });
  assert.ok(r.ok && r.body, "Pinned source download failed");
  assert.ok(
    !r.headers.get("content-encoding") ||
      r.headers.get("content-encoding") === "identity",
    "Compressed transport is not admitted",
  );
  const chunks = [];
  let n = 0;
  const hash = createHash("sha256");
  for await (const b of r.body) {
    n += b.length;
    assert.ok(n <= pin.bytes, "Pinned source size exceeded");
    hash.update(b);
    chunks.push(b);
  }
  assert.equal(n, pin.bytes);
  assert.equal(hash.digest("hex"), pin.sha256);
  return Buffer.concat(chunks);
}

export async function fetchSecurityInputs(destination) {
  const manifest = JSON.parse(
    await readFile(
      new URL("./node-brotli-runtime-sources.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.version, "node-brotli-runtime-sources/v1");
  assert.equal(manifest.node.version, "22.23.4");
  assert.equal(
    manifest.brotli.patchCommit,
    "da9806362874b9bd4b552a3af360b5d6347beb12",
  );
  const root = resolve(destination);
  await mkdir(root, { recursive: false });
  const n = manifest.node;
  const rows = [
    {
      name: n.archive,
      url: "https://nodejs.org/dist/v22.23.4/" + n.archive,
      bytes: n.archiveBytes,
      sha256: n.archiveSha256,
    },
  ];
  // The signed files are separately pinned and remain available to gpgv.
  for (const [name, sha256, bound] of [
    ["SHASUMS256.txt", n.checksumsSha256, 100000],
    ["SHASUMS256.txt.sig", n.signatureSha256, 10000],
  ]) {
    const r = await fetch("https://nodejs.org/dist/v22.23.4/" + name, {
      redirect: "error",
      headers: { "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(90000),
    });
    assert.ok(r.ok && r.body);
    assert.ok(
      !r.headers.get("content-encoding") ||
        r.headers.get("content-encoding") === "identity",
    );
    const chunks = [];
    let total = 0;
    for await (const b of r.body) {
      total += b.length;
      assert.ok(total <= bound);
      chunks.push(b);
    }
    const b = Buffer.concat(chunks);
    assert.equal(createHash("sha256").update(b).digest("hex"), sha256);
    await writeFile(join(root, name), b, { flag: "wx" });
  }
  assert.equal(manifest.brotli.files.length, 4);
  for (const f of manifest.brotli.files) {
    assert.match(f.name, /^[a-zA-Z0-9_.+-]+$/);
    rows.push({
      ...f,
      url: f.name.endsWith(".patch")
        ? "https://github.com/google/brotli/commit/" + f.name
        : "https://deb.debian.org/debian/pool/main/b/brotli/" + f.name,
    });
  }
  for (const f of rows)
    await writeFile(join(root, f.name), await fetchPinnedInput(f.url, f), {
      flag: "wx",
    });
  await mkdir(join(root, "testdata"), { recursive: false });
  for (const f of corpus.files)
    await writeFile(
      join(root, "testdata", f.name),
      await fetchPinnedInput(CORPUS_BASE + f.name, f),
      { flag: "wx" },
    );
  return manifest;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await fetchSecurityInputs(process.argv[2]);
  console.log(
    "Exact Node and Brotli security inputs fetched; signatures still require verification.",
  );
}
