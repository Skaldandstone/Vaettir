// HISTORICAL SYNTHETIC fixtures only. Reading current recipe bytes here does
// not prove historical Git export, native execution or current v2 acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  HISTORICAL_V1_RECIPE_FIXTURE,
  historicalNativeV1RecipeFixture,
} from "./native-v1-recipe-test-fixture.mjs";

const oldLine =
  "dpkg-gencontrol -plibllvm19 -v'1:19.1.7-3+vaettir1' -P\"$root\" -O\"$root/DEBIAN/control\"\n";
const newLine =
  "dpkg-gencontrol -plibllvm19 -v'1:19.1.7-3+vaettir1' -Tdebian/libllvm19.substvars -f/build/libllvm19.files -P\"$root\" -O\"$root/DEBIAN/control\"\n";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixtureInputs() {
  // Raw recipe admission happens BEFORE any general fixture EOL conversion.
  const current = readFileSync(new URL("./build-llvm-runtime.sh", import.meta.url));
  const original = historicalNativeV1RecipeFixture(current).bytes;
  const parts = original.toString("utf8").split(oldLine);
  assert.equal(parts.length, 2);
  const corrected = Buffer.from(parts[0] + newLine + parts[1]);
  assert.equal(hash(corrected), HISTORICAL_V1_RECIPE_FIXTURE.correctedSha256);
  assert.equal(corrected.length, HISTORICAL_V1_RECIPE_FIXTURE.correctedBytes);
  return { original, corrected };
}

test("both exact known recipes become transparently historical original bytes", () => {
  const { original, corrected } = fixtureInputs();
  for (const [source, adapted] of [[original, false], [corrected, true]]) {
    const result = historicalNativeV1RecipeFixture(source);
    assert.deepEqual(result.bytes, original);
    assert.equal(result.purpose, "historical-v1-synthetic-recipe");
    assert.equal(result.sourceSha256, hash(source));
    assert.equal(result.fixtureSha256, HISTORICAL_V1_RECIPE_FIXTURE.originalSha256);
    assert.equal(result.adapted, adapted);
    assert.notEqual(result.bytes, source);
  }
});

test("unknown whole bytes, EOL drift and nonexact packaging substitutions refuse", () => {
  const { original, corrected } = fixtureInputs();
  const changed = Buffer.from(corrected);
  changed[0] ^= 1;
  const malformedUtf8 = Buffer.from(original);
  malformedUtf8[0] = 255;
  for (const raw of [
    changed,
    malformedUtf8,
    Buffer.alloc(0),
    Buffer.alloc(1024 * 1024 + 1),
    Buffer.concat([original, Buffer.from("\n")]),
    Buffer.from(original.toString().replaceAll("\n", "\r\n")),
    Buffer.from(corrected.toString().replace(newLine, newLine + newLine)),
    Buffer.from(corrected.toString().replace(" -f/build/libllvm19.files", "")),
    Buffer.from(corrected.toString().replace(newLine, newLine.replace(" -P", "  -P"))),
    Buffer.from(corrected.toString().replace(newLine, "#" + newLine)),
  ]) assert.throws(() => historicalNativeV1RecipeFixture(raw));
  assert.throws(() => historicalNativeV1RecipeFixture(original.toString()));
  assert.throws(() => historicalNativeV1RecipeFixture(original, { sha256: hash(original) }));
});

test("fixture output has defensive independent bytes and immutable provenance", () => {
  const { original, corrected } = fixtureInputs();
  for (const source of [original, corrected]) {
    const unchanged = Buffer.from(source);
    const result = historicalNativeV1RecipeFixture(source);
    result.bytes[0] ^= 1;
    assert.deepEqual(source, unchanged);
    assert.equal(hash(historicalNativeV1RecipeFixture(source).bytes), HISTORICAL_V1_RECIPE_FIXTURE.originalSha256);
    assert.throws(() => { result.purpose = "current-native-proof"; });
    const fresh = historicalNativeV1RecipeFixture(source);
    source[0] ^= 1;
    assert.equal(hash(fresh.bytes), HISTORICAL_V1_RECIPE_FIXTURE.originalSha256);
    source[0] ^= 1;
  }
});
