import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const originalHash =
  "391705d2c4f2c2ba53ee85d0cd2c6d850c95dcb4ca9dd7659b3d04101bf2c9fa";
const patchHashes = [
  [
    "930008-arm.diff",
    "8167d94b8c47174a0112c960ee4d1f1132fadb9544a63be49e293fd3a8892510",
  ],
  [
    "arm32-defaults.diff",
    "25b1f5df39f3a7f260aaab0af0fdfe9c05abb08f2c9eb940d2e2c78698d73c32",
  ],
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assertion =
  'llvm::Triple Triple("armeb-none-eabi");\n    EXPECT_EQ("arm7tdmi", ARM::getARMCPUForArch(Triple));';

export function reconcileKnownAssertion(source) {
  assert.equal(
    source.split(assertion).length,
    2,
    "Exactly one known assertion required",
  );
  const replacement = assertion.replace('"arm7tdmi"', '"arm926ej-s"');
  const repaired = source.replace(assertion, replacement);
  assert.equal(repaired.replace(replacement, assertion), source);
  assert.equal(
    (source.match(/EXPECT_EQ\(/g) ?? []).length,
    (repaired.match(/EXPECT_EQ\(/g) ?? []).length,
  );
  return repaired;
}

// The signed distro patches intentionally change runtime policy but omit one
// upstream fixture. Never infer a new expected value from a candidate result.
// The separately authored 30-vector probe must first validate the authenticated
// installed Debian baseline; production/parser code and every other assertion
// stay byte-for-byte unchanged. This is our fixture repair, not a Debian fix.
export function reconcileFixture(source, baselineProof) {
  assert.equal(
    sha(Buffer.from(source)),
    originalHash,
    "Original unit source drift",
  );
  assert.ok(baselineProof.length < 4096 && !baselineProof.includes("\r"));
  const lines = baselineProof.trimEnd().split("\n");
  assert.equal(
    lines.length,
    31,
    "Complete independent baseline proof required",
  );
  assert.equal(lines.at(-1), "VAETTIR_LLVM_ARM_POLICY_VECTORS=30");
  assert.equal(new Set(lines).size, 31);
  assert.ok(
    lines
      .slice(0, 30)
      .every((line) =>
        /^VAETTIR_LLVM_ARM_POLICY [a-z0-9-]+ march=[a-z0-9-]* cpu=[a-z0-9-]*$/.test(
          line,
        ),
      ),
  );
  assert.ok(
    lines.includes(
      "VAETTIR_LLVM_ARM_POLICY armeb-none-eabi march= cpu=arm926ej-s",
    ),
  );
  assert.ok(
    lines.includes(
      "VAETTIR_LLVM_ARM_POLICY arm-none-eabihf march= cpu=cortex-a8",
    ),
  );
  const repaired = reconcileKnownAssertion(source);
  return {
    repaired,
    receipt: {
      originalSha256: originalHash,
      repairedSha256: sha(Buffer.from(repaired)),
      baselineProofSha256: sha(Buffer.from(baselineProof)),
      fixtureAssertionsReconciled: 1,
      baselinePolicyUnchanged: true,
      assertionsRemoved: 0,
      candidateDerivedExpectation: false,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--signed-debian-image-build"]);
  assert.equal(process.platform, "linux");
  for (const [name, hash] of patchHashes)
    assert.equal(
      sha(readFileSync(`/build/llvm-source/debian/patches/${name}`)),
      hash,
      "Signed maintained patch drift",
    );
  const file =
    "/build/llvm-source/llvm/unittests/TargetParser/TargetParserTest.cpp";
  const { repaired, receipt } = reconcileFixture(
    readFileSync(file, "utf8"),
    readFileSync("/build/llvm-arm-baseline.txt", "utf8"),
  );
  writeFileSync(file, repaired);
  writeFileSync(
    "/build/llvm-arm-unit-fixture-proof.json",
    JSON.stringify(receipt) + "\n",
  );
  console.log(
    "Independent Debian ARM baseline and exact unit fixture reconciled: " +
      JSON.stringify(receipt),
  );
}
