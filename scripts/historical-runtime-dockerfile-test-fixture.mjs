// TEST FIXTURE ONLY. Never import into production planners or validators.
// Restores exact historical synthetic Dockerfile input, not current Git export.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { GIT_OPENSSL_DOCKERFILE_SHA256, restorePreGitOpensslDockerfileFixture } from "./git-openssl-dockerfile-inverse-fixture.mjs";
export const HISTORICAL_DOCKERFILE_SHA256 =
  "06624ebd0b0fcc95a2c91c7501d7037eb11b830d4d273cb98c9f76dd0d2a9f34";
export const ABSENCE_FIXED_DOCKERFILE_SHA256 =
  "bdcc0fd1dff0b04962aaecbf9400d4aebdb7c9390ae1d47bb5a5aa5766e475a3";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const added =
  "# Validate dpkg-query semantic absence for libxml2, including not-installed stubs.\n" +
  "COPY scripts/check-runtime-package-absence.mjs /usr/local/lib/vaettir/check-runtime-package-absence.mjs\n";
const oldGuard =
  "    && test -z \"$(dpkg-query -W -f='${db:Status-Abbrev}' libxml2 2>/dev/null)\"";
const newGuard =
  "    && node /usr/local/lib/vaettir/check-runtime-package-absence.mjs --image-build";

export function historicalRuntimeDockerfileFixture(raw) {
  assert.equal(arguments.length, 1);
  assert.ok(Buffer.isBuffer(raw));
  const currentSourceHash = sha(raw);
  if (currentSourceHash === GIT_OPENSSL_DOCKERFILE_SHA256)
    raw = restorePreGitOpensslDockerfileFixture(raw);
  const text = raw.toString("utf8");
  assert.deepEqual(Buffer.from(text), raw);
  assert.equal(text.includes("\r"), false, "Only exact known LF input");
  const hash = sha(raw);
  assert.ok(
    hash === HISTORICAL_DOCKERFILE_SHA256 ||
      hash === ABSENCE_FIXED_DOCKERFILE_SHA256,
    "Unknown complete Dockerfile edit",
  );
  let bytes = Buffer.from(raw);
  if (hash === ABSENCE_FIXED_DOCKERFILE_SHA256) {
    assert.equal(text.split(added).length, 2);
    assert.equal(text.split(newGuard).length, 2);
    bytes = Buffer.from(text.replace(added, "").replace(newGuard, oldGuard));
  }
  assert.equal(sha(bytes), HISTORICAL_DOCKERFILE_SHA256);
  return Object.freeze({
    purpose: "historical-runtime-dockerfile-synthetic-test-only",
    sourceSha256: currentSourceHash,
    fixtureSha256: sha(bytes),
    bytes,
  });
}
