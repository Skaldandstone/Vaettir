import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  reconcileFixture,
  reconcileKnownAssertion,
} from "./reconcile-llvm-arm-unit-fixture.mjs";

test("exact one-literal repair retains independent controls and every assertion", () => {
  const assertion =
    'llvm::Triple Triple("armeb-none-eabi");\n    EXPECT_EQ("arm7tdmi", ARM::getARMCPUForArch(Triple));';
  const source =
    'EXPECT_EQ("cortex-a8", control);\n' +
    assertion +
    '\nEXPECT_EQ("", invalid);\n';
  assert.equal(
    reconcileKnownAssertion(source),
    source.replace('"arm7tdmi"', '"arm926ej-s"'),
  );
  for (const drift of [
    source.replace("armeb-none-eabi", "arm-none-eabi"),
    source + assertion,
    source.replace('"arm7tdmi"', '"changed"'),
  ])
    assert.throws(() => reconcileKnownAssertion(drift), /Exactly one/);
});

test("fixture reconciliation refuses unverified original source before writing", () => {
  assert.throws(
    () =>
      reconcileFixture(
        'llvm::Triple Triple("armeb-none-eabi");\n    EXPECT_EQ("arm7tdmi", ARM::getARMCPUForArch(Triple));',
        "candidate output",
      ),
    /source drift/,
  );
});
test("builder verifies an independent installed baseline before one fixture repair; all unit and runtime gates remain", () => {
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  );
  const probe = script.indexOf(
    "timeout 10 /build/llvm-arm-policy > /build/llvm-arm-baseline.txt",
  );
  const repair = script.indexOf(
    "reconcile-llvm-arm-unit-fixture.mjs --signed-debian-image-build",
  );
  assert.ok(
    probe > 0 &&
      repair > probe &&
      repair < script.indexOf("--target LLVM llvm-config"),
  );
  assert.match(script, /--target check-llvm-unit/);
  assert.match(
    script,
    /cmp \/build\/llvm-arm-baseline.txt \/build\/llvm-arm-candidate.txt/,
  );
  assert.match(
    script,
    /! grep -E 'RPATH\|RUNPATH' \/build\/llvm-arm-policy-dynamic.txt/,
  );
  assert.doesNotMatch(
    script,
    /gtest_filter|xfail|XFAIL|--filter|nocheck|\|\| true/,
  );
  const helper = readFileSync(
    new URL("./reconcile-llvm-arm-unit-fixture.mjs", import.meta.url),
    "utf8",
  );
  assert.match(helper, /fixtureAssertionsReconciled: 1/);
  assert.match(helper, /assertionsRemoved: 0/);
  assert.match(helper, /candidateDerivedExpectation: false/);
});
