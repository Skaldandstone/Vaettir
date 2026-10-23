import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
const input = resolve(process.argv[2]),
  source = resolve(process.argv[3]),
  manifest = JSON.parse(
    readFileSync(new URL("./brotli-runtime-test-corpus.json", import.meta.url)),
  ),
  sha = (b) => createHash("sha256").update(b).digest("hex");
assert.equal(manifest.commit, "ed738e842d2fbdf2d6459e39267a633c4a9b2f5d");
assert.equal(manifest.files.length, 67);
assert.equal(new Set(manifest.files.map((f) => f.name)).size, 67);
const expected = manifest.files.map((f) => f.name).sort();
assert.deepEqual(readdirSync(input).sort(), expected);
for (const f of manifest.files) {
  assert.match(f.name, /^[A-Za-z0-9_.-]+$/);
  const b = readFileSync(join(input, f.name));
  assert.equal(b.length, f.bytes);
  assert.equal(sha(b), f.sha256);
  const target = join(source, "tests/testdata", f.name);
  if (existsSync(target))
    assert.deepEqual(
      readFileSync(target),
      b,
      "Existing Debian fixture must match the immutable upstream corpus",
    );
  else writeFileSync(target, b, { flag: "wx" });
}
assert.deepEqual(readdirSync(join(source, "tests/testdata")).sort(), expected);
console.log(
  "All 67 original upstream Brotli test inputs retained byte-for-byte.",
);
