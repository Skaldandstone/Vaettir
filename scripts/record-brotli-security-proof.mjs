import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
const build = resolve(process.argv[2]),
  scripts = resolve(process.argv[3]),
  sha = (b) => createHash("sha256").update(b).digest("hex");
const pin = JSON.parse(
    readFileSync(join(scripts, "node-brotli-runtime-sources.json")),
  ),
  run = (...args) =>
    execFileSync("readelf", args, {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 4 * 1024 ** 2,
    });
function inspect(file) {
  const dynamic = run("--dynamic", "--wide", file);
  assert.doesNotMatch(dynamic, /\((?:RPATH|RUNPATH)\)/);
  const soname = dynamic.match(/\(SONAME\).*\[([^\]]+)\]/)?.[1];
  assert.ok(soname);
  const needed = [...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)]
    .map((x) => x[1])
    .sort();
  const exports = run("--dyn-syms", "--wide", file)
    .split("\n")
    .flatMap((line) => {
      const f = line.trim().split(/\s+/);
      if (
        !/^\d+:$/.test(f[0] ?? "") ||
        !["GLOBAL", "WEAK"].includes(f[4]) ||
        f[6] === "UND" ||
        !["FUNC", "OBJECT", "TLS"].includes(f[3])
      )
        return [];
      return [
        {
          name: f[7],
          type: f[3],
          binding: f[4],
          visibility: f[5],
          ...(f[3] === "FUNC" ? {} : { size: Number(f[2]) }),
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  assert.ok(exports.length > 0);
  return { soname, needed, exports };
}
const libraries = [];
const baselinePackage = Object.fromEntries(
  [
    ["binaryVersion", "${Version}"],
    ["sourceVersion", "${source:Version}"],
    ["architecture", "${Architecture}"],
  ].map(([name, field]) => [
    name,
    execFileSync("dpkg-query", ["-W", "-f=" + field, "libbrotli1"], {
      encoding: "utf8",
      timeout: 10000,
    }).trim(),
  ]),
);
assert.equal(baselinePackage.binaryVersion, pin.brotli.baselineBinaryVersion);
assert.equal(baselinePackage.sourceVersion, pin.brotli.sourceVersion);
assert.equal(baselinePackage.architecture, "amd64");
for (const name of ["libbrotlicommon", "libbrotlidec", "libbrotlienc"]) {
  const baseline = "/usr/lib/x86_64-linux-gnu/" + name + ".so.1.1.0",
    file = join(build, "runtime/usr/lib/x86_64-linux-gnu", name + ".so.1.1.0"),
    before = inspect(baseline),
    after = inspect(file);
  assert.equal(after.soname, name + ".so.1");
  assert.deepEqual(
    after,
    before,
    "Brotli public data/function ABI or loader dependencies changed",
  );
  const b = readFileSync(file);
  libraries.push({
    name: name + ".so.1.1.0",
    bytes: b.length,
    sha256: sha(b),
    baselineSha256: sha(readFileSync(baseline)),
    ...after,
  });
}
const tests = JSON.parse(
  readFileSync(join(build, "proof/receipts/brotli-test-inventory.json")),
).tests;
assert.ok(tests.length > 0);
const log = readFileSync(
  join(build, "proof/receipts/brotli-native-tests.log"),
  "utf8",
);
assert.match(log, /100% tests passed, 0 tests failed/);
assert.match(
  readFileSync(join(build, "proof/receipts/brotli-regression.txt"), "utf8"),
  /^BROTLI_BLOCK_SWITCH_PASS /,
);
assert.match(
  readFileSync(
    join(build, "proof/receipts/brotli-negative-control.txt"),
    "utf8",
  ),
  /^BROTLI_BLOCK_SWITCH_REJECTED /,
);
const pkg = readFileSync(join(build, "libbrotli1_1.1.0-2+vaettir1_amd64.deb"));
const sourceCommit = process.env.VAETTIR_SECURITY_SOURCE_COMMIT;
assert.match(sourceCommit ?? "", /^[a-f0-9]{40}$/);
const corpus = JSON.parse(
  readFileSync(join(scripts, "brotli-runtime-test-corpus.json")),
);
assert.equal(corpus.fileCount, 67);
assert.equal(corpus.totalBytes, 15474193);
const proof = {
  purpose: "node-brotli-security-proof/v1",
  sourceCommit,
  sourceVersion: pin.brotli.sourceVersion,
  baselinePackage,
  testCorpusCommit: corpus.commit,
  testCorpusFiles: corpus.fileCount,
  testCorpusBytes: corpus.totalBytes,
  packageVersion: pin.brotli.packageVersion,
  patchCommit: pin.brotli.patchCommit,
  packageSha256: sha(pkg),
  packageBytes: pkg.length,
  nativeTestCount: tests.length,
  allNativeCmakeTestsPassed: true,
  actualPackagedDecoderRegressionPassed: true,
  wholeAndByteStreamError: -17,
  unpatchedControlExit: 42,
  exploitReproductionClaimed: false,
  sonamesExportsDataTlsAndNeededPreserved: true,
  libraries,
  sourceHashes: Object.fromEntries(
    [
      "build-node-brotli-security.sh",
      "record-brotli-security-proof.mjs",
      "node-brotli-runtime-sources.json",
      "fetch-node-brotli-sources.mjs",
      "check-node-security-runtime.mjs",
      "check-brotli-block-switch.c",
      "retain-brotli-test-corpus.mjs",
      "brotli-runtime-test-corpus.json",
    ].map((p) => [p, sha(readFileSync(join(scripts, p)))]),
  ),
  node: JSON.parse(
    readFileSync(join(build, "proof/receipts/node-regression.json")),
  ),
  productionAccepted: false,
};
writeFileSync(
  join(build, "proof/receipts/security-proof.json"),
  JSON.stringify(proof, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    nativeTestCount: tests.length,
    packageSha256: proof.packageSha256,
    actualRegressionPassed: true,
    abiPreserved: true,
    productionAccepted: false,
  }),
);
