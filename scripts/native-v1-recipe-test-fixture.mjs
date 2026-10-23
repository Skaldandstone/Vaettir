// TEST FIXTURE ONLY. Never import into a production planner, CLI or receipt
// validator. These bytes represent historical v1 SYNTHETIC test input, not
// current canonical Git export, native execution or deployment evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const HISTORICAL_V1_RECIPE_FIXTURE = Object.freeze({
  purpose: "historical-v1-synthetic-recipe",
  originalSha256:
    "c5c97e29d3722314faf2d09cda17a495972df30ab003ac55e80b6d18f308a0b9",
  originalBytes: 21226,
  correctedSha256:
    "0a35a384df5974dab2163484566a7abe2f65b62cce8061340089a7837e98aa87",
  correctedBytes: 21280,
});

const originalLine =
  "dpkg-gencontrol -plibllvm19 -v'1:19.1.7-3+vaettir1' -P\"$root\" -O\"$root/DEBIAN/control\"\n";
const correctedLine =
  "dpkg-gencontrol -plibllvm19 -v'1:19.1.7-3+vaettir1' -Tdebian/libllvm19.substvars -f/build/libllvm19.files -P\"$root\" -O\"$root/DEBIAN/control\"\n";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function historicalNativeV1RecipeFixture(raw) {
  assert.equal(arguments.length, 1, "No caller-supplied fixture policy");
  assert.ok(Buffer.isBuffer(raw), "Fixture input must be raw recipe bytes");
  assert.ok(
    raw.length === HISTORICAL_V1_RECIPE_FIXTURE.originalBytes ||
      raw.length === HISTORICAL_V1_RECIPE_FIXTURE.correctedBytes,
    "Unsupported whole recipe size",
  );
  const sourceSha256 = sha256(raw);
  assert.ok(
    (sourceSha256 === HISTORICAL_V1_RECIPE_FIXTURE.originalSha256 &&
      raw.length === HISTORICAL_V1_RECIPE_FIXTURE.originalBytes) ||
      (sourceSha256 === HISTORICAL_V1_RECIPE_FIXTURE.correctedSha256 &&
        raw.length === HISTORICAL_V1_RECIPE_FIXTURE.correctedBytes),
    "Unsupported whole recipe identity",
  );
  const text = raw.toString("utf8");
  assert.ok(Buffer.from(text, "utf8").equals(raw), "Invalid UTF-8 recipe");
  assert.equal(text.includes("\r"), false, "Only exact known LF input");
  let bytes;
  const adapted =
    sourceSha256 === HISTORICAL_V1_RECIPE_FIXTURE.correctedSha256;
  if (adapted) {
    const parts = text.split(correctedLine);
    assert.equal(parts.length, 2, "Exactly one complete corrected line");
    assert.ok(parts[0].endsWith("\n"), "Corrected line must start a line");
    bytes = Buffer.from(parts[0] + originalLine + parts[1], "utf8");
  } else {
    bytes = Buffer.from(raw);
  }
  assert.equal(bytes.length, HISTORICAL_V1_RECIPE_FIXTURE.originalBytes);
  const fixtureSha256 = sha256(bytes);
  assert.equal(fixtureSha256, HISTORICAL_V1_RECIPE_FIXTURE.originalSha256);
  return Object.freeze({
    purpose: HISTORICAL_V1_RECIPE_FIXTURE.purpose,
    sourceSha256,
    fixtureSha256,
    adapted,
    bytes,
  });
}
