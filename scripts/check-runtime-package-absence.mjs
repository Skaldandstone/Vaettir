import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// dpkg-query includes dependency-referenced packages even when not installed.
// Only an explicit not-installed state or a verified no-match is absence.
export function validateRuntimePackageAbsence(result) {
  assert.ok(result && typeof result === "object");
  assert.equal(result.error, undefined, "Package query failed");
  assert.equal(result.signal ?? null, null, "Package query interrupted");
  assert.equal(typeof result.stdout, "string");
  assert.equal(typeof result.stderr, "string");
  assert.ok(result.stdout.length <= 4096 && result.stderr.length <= 4096);
  if (result.status === 1) {
    assert.equal(result.stdout, "", "Partial package query is not absence");
    assert.equal(
      result.stderr,
      "dpkg-query: no packages found matching libxml2\n",
      "Unrecognized package query failure",
    );
    return "no-match";
  }
  assert.equal(result.status, 0, "Package query unsuccessful");
  assert.equal(result.stderr, "", "Unexpected package query diagnostics");
  assert.match(
    result.stdout,
    /^[uihrp]n $/,
    "libxml2 installed, residual, unsafe or unknown package state",
  );
  return "not-installed";
}

export function checkRuntimePackageAbsence(run = spawnSync) {
  const result = run(
    "/usr/bin/dpkg-query",
    ["-W", "-f=${db:Status-Abbrev}", "libxml2"],
    {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 4096,
      env: { ...process.env, LANG: "C", LC_ALL: "C", LANGUAGE: "C" },
    },
  );
  return validateRuntimePackageAbsence(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--image-build"]);
  console.log("libxml2 runtime absence verified: " + checkRuntimePackageAbsence());
}
