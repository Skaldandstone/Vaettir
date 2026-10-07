import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  checkRuntimePackageAbsence,
  validateRuntimePackageAbsence,
} from "./check-runtime-package-absence.mjs";

const result = (stdout, status = 0, stderr = "") => ({
  status,
  stdout,
  stderr,
  signal: null,
});

test("dependency-only not-installed dpkg stub is absence, unlike empty-output guard", () => {
  assert.equal(validateRuntimePackageAbsence(result("un ")), "not-installed");
  assert.notEqual("un ", "");
  for (const want of ["i", "h", "r", "p"])
    assert.equal(validateRuntimePackageAbsence(result(want + "n ")), "not-installed");
});

test("exact no-package result is absence, not any arbitrary failed query", () => {
  assert.equal(
    validateRuntimePackageAbsence(
      result("", 1, "dpkg-query: no packages found matching libxml2\n"),
    ),
    "no-match",
  );
  for (const r of [
    result("", 1),
    result("", 1, "database unreadable"),
    result("un ", 1, "dpkg-query: no packages found matching libxml2\n"),
    result("", 2),
    result("", null),
    { ...result("un "), signal: "SIGTERM" },
    { ...result("un "), error: new Error("timeout") },
  ]) assert.throws(() => validateRuntimePackageAbsence(r));
});

test("installed, residual, unpacked, partial, malformed and error states fail closed", () => {
  for (const status of [
    "ii ", "hi ", "ri ", "pi ", "rc ", "ic ", "iU ", "iH ",
    "iF ", "iW ", "it ", "unR", "un", "un \n", "unknown",
    "un ii ", "", "xn ", "un  ",
  ]) assert.throws(() => validateRuntimePackageAbsence(result(status)), status);
  assert.throws(() => validateRuntimePackageAbsence(result("un ", 0, "warning")));
});

test("actual query uses bounded fixed package and deterministic diagnostics", () => {
  assert.equal(checkRuntimePackageAbsence((command, args, options) => {
    assert.equal(command, "/usr/bin/dpkg-query");
    assert.deepEqual(args, ["-W", "-f=${db:Status-Abbrev}", "libxml2"]);
    assert.equal(options.encoding, "utf8");
    assert.equal(options.timeout, 10_000);
    assert.equal(options.maxBuffer, 4096);
    for (const key of ["LANG", "LC_ALL", "LANGUAGE"])
      assert.equal(options.env[key], "C");
    return result("un ");
  }), "not-installed");
});

test("runtime recipe copies verifier before apt and checks before git/cleanup", () => {
  const docker = readFileSync(new URL("../Dockerfile.api", import.meta.url), "utf8");
  const copy = docker.indexOf("COPY scripts/check-runtime-package-absence.mjs /usr/local/lib/vaettir/check-runtime-package-absence.mjs");
  const run = docker.indexOf("RUN apt-get update", copy);
  const guard = docker.indexOf("&& node /usr/local/lib/vaettir/check-runtime-package-absence.mjs --image-build", run);
  assert.ok(copy > 0 && run > copy && guard > run);
  assert.ok(docker.indexOf("&& git --version", guard) > guard);
  assert.doesNotMatch(docker, /test -z.*Status-Abbrev.*libxml2/);
});
