// Synthetic operation/byte fixtures ONLY. No native image, shell, filesystem,
// AWS, Git, package installation or caller code is executed by these tests.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { Script } from "node:vm";
import { posix } from "node:path";
import {
  verifyNativeFreshFinalState,
  inspectFinalDebianPackage,
  parseFinalJson,
  readFinalUnitStreams,
  nativeFreshFinalVerifierProgram,
  FINAL_PHASES,
} from "./native-builder-fresh-final-verifier.mjs";

const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const json = (value) => Buffer.from(JSON.stringify(value) + "\n");
const hashOf = (label) => hash(Buffer.from(label));
const trees = (path) => ({
  sha256: hashOf("synthetic-tree:" + path),
  entries: 200,
  bytes: 10000,
});
const scriptNames = [
  "build-llvm-runtime.sh",
  "native-build-concurrency.mjs",
  "native-llvm-checkpoint.mjs",
  "fetch-runtime-vendor-sources.mjs",
  "runtime-vendor-sources.json",
  "check-llvm-package.mjs",
  "check-llvm-jit.c",
  "check-llvm-arm-defaults.cpp",
  "reconcile-llvm-arm-unit-fixture.mjs",
];

function tar(entries) {
  const output = [];
  const octal = (header, offset, width, number) =>
    header.write(
      number.toString(8).padStart(width - 1, "0") + "\0",
      offset,
      width,
      "ascii",
    );
  for (const entry of entries) {
    const raw = entry.raw ?? Buffer.alloc(0),
      header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, "utf8");
    octal(
      header,
      100,
      8,
      entry.mode ?? (entry.kind === "symlink" ? 0o777 : 0o644),
    );
    octal(header, 108, 8, 0);
    octal(header, 116, 8, 0);
    octal(header, 124, 12, raw.length);
    octal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] =
      entry.kind === "symlink" ? 50 : entry.kind === "directory" ? 53 : 48;
    if (entry.link) header.write(entry.link, 157, 100, "utf8");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(
      checksum.toString(8).padStart(6, "0") + "\0 ",
      148,
      8,
      "ascii",
    );
    output.push(header, raw, Buffer.alloc((512 - (raw.length % 512)) % 512));
  }
  return Buffer.concat([...output, Buffer.alloc(1024)]);
}
function ar(members) {
  return Buffer.concat([
    Buffer.from("!<arch>\n"),
    ...members.flatMap(([name, raw]) => {
      const header = Buffer.from(
        (name + "/").padEnd(16) +
          "0".padEnd(12) +
          "0".padEnd(6) +
          "0".padEnd(6) +
          "100644".padEnd(8) +
          String(raw.length).padEnd(10) +
          "`\n",
      );
      assert.equal(header.length, 60);
      return [header, raw, ...(raw.length % 2 ? [Buffer.from("\n")] : [])];
    }),
  ]);
}
function deb(control, data) {
  return ar([
    ["debian-binary", Buffer.from("2.0\n")],
    ["control.tar.gz", gzipSync(tar(control))],
    ["data.tar.gz", gzipSync(tar(data))],
  ]);
}
function decode(kind, raw, max) {
  assert.equal(kind, "gz");
  return gunzipSync(raw, { maxOutputLength: max });
}

function fixture() {
  const files = new Map(),
    calls = [];
  const put = (path, value) => {
    const raw = Buffer.isBuffer(value)
      ? value
      : typeof value === "string"
        ? Buffer.from(value)
        : json(value);
    files.set(path, raw);
    return raw;
  };
  const scriptPins = {};
  for (const name of scriptNames)
    scriptPins[name] = hash(
      put("/build/scripts/" + name, "// synthetic native script " + name),
    );
  const manifest = put("/build/llvm-sources/source-manifest.json", {
    fixture: "public synthetic source",
  });
  put("/build/llvm-baseline-library", "synthetic baseline");
  const baselineHash = hash(files.get("/build/llvm-baseline-library"));
  put(
    "/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1",
    files.get("/build/llvm-baseline-library"),
  );
  const compiler = {
    compilerSha256: hashOf("compiler"),
    compiler: "Debian clang version 19.1.7 (3+b1)\n",
    compilerPackage: "1:19.1.7-3+b1",
    installedPackagesSha256: hashOf("packages"),
  };
  const configHashes = [];
  for (const name of ["release", "assertions"]) {
    const dir =
      name === "release" ? "/build/llvm-build" : "/build/llvm-assert-build";
    const cache = put(
      dir + "/CMakeCache.txt",
      [
        "CMAKE_BUILD_TYPE:STRING=RelWithDebInfo",
        "CMAKE_C_FLAGS_RELWITHDEBINFO:STRING=-O2 -DNDEBUG -g1",
        "CMAKE_CXX_FLAGS_RELWITHDEBINFO:STRING=-O2 -DNDEBUG -g1",
        "LLVM_ENABLE_ASSERTIONS:BOOL=" + (name === "release" ? "OFF" : "ON"),
        "LLVM_BUILD_LLVM_DYLIB:BOOL=" + (name === "release" ? "ON" : "OFF"),
        "LLVM_LINK_LLVM_DYLIB:BOOL=" + (name === "release" ? "ON" : "OFF"),
        "LLVM_USE_PERF:BOOL=ON",
        "LLVM_ABI_BREAKING_CHECKS:STRING=FORCE_OFF",
      ].join("\n") + "\n",
    );
    const commands = put(
      dir + "/compile_commands.json",
      Array.from({ length: 111 }, (_, i) => ({
        file:
          i === 0
            ? "/build/llvm-source/llvm/lib/ExecutionEngine/PerfJITEvents/PerfJITEventListener.cpp"
            : "/build/llvm-source/llvm/" +
              (i < 101 ? "lib" : "unittests") +
              `/Synthetic${i}.cpp`,
        command:
          "clang++-19 -O2 -DNDEBUG -g1" +
          (name === "assertions" ? " -UNDEBUG" : ""),
      })),
    );
    configHashes.push({ cache: hash(cache), commands: hash(commands) });
    put(
      dir + "/include/llvm/Config/llvm-config.h",
      "#define LLVM_USE_PERF 1\n",
    );
    put(
      dir + "/include/llvm/Config/abi-breaking.h",
      "#define LLVM_ENABLE_ABI_BREAKING_CHECKS 0\n",
    );
    put("/build/llvm-" + name + "-configuration.json", {
      variant: name,
      buildType: "RelWithDebInfo",
      assertions: name === "release" ? "OFF" : "ON",
      sharedDylib: name === "release",
      abiBreakingChecks: false,
      perfJitComponent: true,
      verifiedTranslationUnits: 111,
      flags: "-O2 -DNDEBUG -g1",
      effectiveNdebug: name === "release" ? "defined" : "undefined",
    });
  }
  const partition = put("/build/llvm-assertion-partitions.json", {
    schemaVersion: 1,
    purpose: "llvm-assertion-compilation-only",
    graphSha256: hashOf("original complete graph"),
    targets: [0, 1, 2].map((part) =>
      Array.from(
        { length: 40 },
        (_, i) => `unittests/Synthetic${part * 40 + i}.cpp.o`,
      ),
    ),
    unitAcceptance: false,
  });
  put("/build/llvm-build-graphs.json", {
    release: {
      scheduledCommands: 3000,
      compilationCommands: 2900,
      acceptance: false,
    },
    assertions: {
      scheduledCommands: 4000,
      compilationCommands: 3800,
      acceptance: false,
    },
  });
  const inputs = {
    scripts: trees("/build/scripts"),
    signedSources: trees("/build/llvm-sources"),
    source: trees("/build/llvm-source"),
    toolchain: compiler,
    baselineSha256: baselineHash,
    configuration: configHashes,
    assertionPlanSha256: hash(partition),
  };
  const unstripped = put(
    "/build/llvm-build/lib/libLLVM.so.19.1",
    "synthetic unstripped native candidate",
  );
  const stripped = put(
    "/build/llvm-source/debian/libllvm19/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1",
    "synthetic stripped native candidate",
  );
  const abiValue = (raw) => ({
    baselineExports: 100,
    candidateExports: 101,
    soname: "libLLVM.so.19.1",
    needed: ["libc.so.6"],
    compiler: "Debian clang version 19.1.7 (3+b1)",
    compilerPackage: "clang-19 1:19.1.7-3+b1",
    baselineSha256: baselineHash,
    candidateSha256: hash(raw),
    source: "Debian llvm-toolchain-19 1:19.1.7-3",
    packageVersion: "1:19.1.7-3+vaettir1",
    change: "Synthetic fixture only",
    runtimeAccepted: false,
  });
  const early = put("/build/llvm-early-abi.json", abiValue(unstripped));
  put("/build/llvm-abi.json", abiValue(unstripped));
  put("/build/llvm-stripped-abi.json", abiValue(stripped));
  const arm = put(
    "/build/llvm-arm-baseline.txt",
    [
      "VAETTIR_LLVM_ARM_POLICY armeb-none-eabi march= cpu=arm926ej-s",
      "VAETTIR_LLVM_ARM_POLICY arm-unknown-none-eabihf march= cpu=cortex-a8",
      ...Array.from(
        { length: 31 },
        (_, i) => `VAETTIR_LLVM_ARM_POLICY synthetic${i} march= cpu=generic`,
      ),
      "VAETTIR_LLVM_ARM_POLICY_VECTORS=33",
    ].join("\n") + "\n",
  );
  put("/build/llvm-arm-candidate.txt", arm);
  put("/build/llvm-arm-policy", "Synthetic fixed ARM ELF");
  put("/build/llvm-cpu-jit", "Synthetic fixed JIT ELF");
  put("/build/llvm-arm-unit-fixture-proof.json", {
    originalSha256:
      "391705d2c4f2c2ba53ee85d0cd2c6d850c95dcb4ca9dd7659b3d04101bf2c9fa",
    repairedSha256: hashOf("repaired public test"),
    baselineProofSha256: hash(arm),
    fixtureAssertionsReconciled: 1,
    baselinePolicyUnchanged: true,
    assertionsRemoved: 0,
    candidateDerivedExpectation: false,
  });
  const gates = put("/build/llvm-final-unit-gates.json", {
    schemaVersion: 1,
    releaseTarget: "check-llvm-unit",
    assertionTarget: "check-llvm-unit",
    releasePassed: true,
    assertionPassed: true,
  });
  const rawLog = Buffer.from(
    "+ timeout 1800 cmake --build /build/llvm-build --parallel 5 --target check-llvm-unit\nTotal Discovered Tests: 120\n  Skipped: 5 (4.17%)\n  Passed : 115 (95.83%)\n+ timeout 7200 cmake --build /build/llvm-assert-build --parallel 5 --target check-llvm-unit\nTotal Discovered Tests: 120\n  Unsupported: 2 (1.67%)\n  Passed : 118 (98.33%)\n",
  );
  const controlEntries = [
    {
      path: "control",
      raw: Buffer.from(
        "Package: libllvm19\nSource: llvm-toolchain-19 (1:19.1.7-3)\nVersion: 1:19.1.7-3+vaettir1\nArchitecture: amd64\nDepends: libc6 (>= 2.39)\nDescription: Synthetic fixture\n",
      ),
    },
    {
      path: "shlibs",
      raw: Buffer.from("libLLVM 19.1 libllvm19 (>= 1:19.1.7-3+vaettir1)\n"),
    },
    { path: "triggers", raw: Buffer.from("activate-noawait ldconfig\n") },
  ];
  const dataEntries = [
    { path: "usr/lib/x86_64-linux-gnu/libLLVM.so.19.1", raw: stripped },
    {
      path: "usr/lib/x86_64-linux-gnu/libLLVM-19.so",
      kind: "symlink",
      link: "libLLVM.so.19.1",
    },
    {
      path: "usr/share/doc/libllvm19/copyright",
      raw: Buffer.from("Synthetic copyright fixture"),
    },
    ...[
      "llvm-unstripped-abi.json",
      "llvm-source-manifest.json",
      "llvm-arm-policy-baseline.txt",
      "llvm-arm-unit-fixture-proof.json",
      "llvm-release-configuration.json",
      "llvm-assertions-configuration.json",
      "llvm-build-graphs.json",
      "llvm-arm-policy",
      "llvm-abi.json",
    ].map((name) => ({
      path: "usr/share/vaettir/" + name,
      mode: name === "llvm-arm-policy" ? 0o755 : 0o644,
      raw: files.get(
        name === "llvm-unstripped-abi.json"
          ? "/build/llvm-abi.json"
          : name === "llvm-source-manifest.json"
            ? "/build/llvm-sources/source-manifest.json"
            : name === "llvm-arm-policy-baseline.txt"
              ? "/build/llvm-arm-baseline.txt"
              : name === "llvm-abi.json"
                ? "/build/llvm-stripped-abi.json"
                : "/build/" + name,
      ),
    })),
  ];
  const packagePath = "/build/libllvm19_19.1.7-3+vaettir1_amd64.deb";
  put(packagePath, deb(controlEntries, dataEntries));
  const finalProof = {
    abiReceiptSha256: hash(files.get("/build/llvm-stripped-abi.json")),
    packageSha256: hash(files.get(packagePath)),
    unitReceiptSha256: hash(gates),
  };
  for (const name of [
    "llvm-abi.json",
    "llvm-cpu-jit",
    "llvm-arm-policy",
    "llvm-release-configuration.json",
    "llvm-assertions-configuration.json",
  ])
    finalProof[name] = hash(files.get("/build/" + name));
  const receipts = [];
  let previous = null;
  for (const phase of FINAL_PHASES) {
    const raw = put("/build/llvm-phase-receipts/" + phase + ".json", {
      schemaVersion: 1,
      purpose: "llvm-builder-checkpoint-not-runtime",
      phase,
      predecessorSha256: previous,
      inputs,
      inputsSha256: hash(JSON.stringify(inputs)),
      state: {
        release: trees("/build/llvm-build"),
        assertions: trees("/build/llvm-assert-build"),
      },
      proof:
        phase === "final"
          ? finalProof
          : phase === "release-core"
            ? { abiReceiptSha256: hash(early) }
            : {},
      unitAcceptance: phase === "final",
      packageAcceptance: phase === "final",
      runtimeAcceptance: false,
      authenticatedAcceptance: false,
      deploymentAcceptance: false,
    });
    previous = hash(raw);
    receipts.push({ phase, sha256: previous });
  }
  const expected = {
    sourceCommit: "a".repeat(40),
    sourceSha256: hashOf("original archive"),
    verificationId: hashOf("root verified plan"),
    inputs,
    scriptPins,
    sourceManifestSha256: hash(manifest),
    receipts,
    coreCandidateSha256: hash(unstripped),
    coreAbiReceiptSha256: hash(early),
    finalLogSha256: hash(rawLog),
  };
  const specialHashes = {
    "/build/llvm-source/llvm/unittests/TargetParser/TargetParserTest.cpp":
      hashOf("repaired public test"),
    "/build/llvm-source/debian/patches/930008-arm.diff":
      "8167d94b8c47174a0112c960ee4d1f1132fadb9544a63be49e293fd3a8892510",
    "/build/llvm-source/debian/patches/arm32-defaults.diff":
      "25b1f5df39f3a7f260aaab0af0fdfe9c05abb08f2c9eb940d2e2c78698d73c32",
  };
  const ops = {
    read(path, max) {
      calls.push(["read", path, max]);
      assert.ok(files.has(path), "Synthetic fixture path missing: " + path);
      const value = files.get(path);
      assert.ok(value.length <= max);
      return value;
    },
    list(path) {
      calls.push(["list", path]);
      if (path === "/build/scripts") return [...scriptNames];
      assert.equal(path, "/build/llvm-phase-receipts");
      return FINAL_PHASES.map((phase) => phase + ".json");
    },
    exists(path) {
      calls.push(["exists", path]);
      return files.has(path);
    },
    hashFile(path, max) {
      calls.push(["hashFile", path, max]);
      return {
        sha256: specialHashes[path] ?? hash(ops.read(path, max)),
        bytes: files.get(path)?.length ?? 10,
      };
    },
    compiler() {
      calls.push(["compiler"]);
      return structuredClone(compiler);
    },
    native: {
      inventoryTree(path, options) {
        calls.push(["inventoryTree", path, options]);
        return trees(path);
      },
      hashCandidateLibrary(root, phase, options) {
        calls.push(["hashCandidateLibrary", root, phase, options]);
        assert.equal(root, "/build");
        const raw = phase === "final" ? stripped : unstripped;
        return { sha256: hash(raw), bytes: raw.length };
      },
      verifyLlvmCompatibility(baseline, candidate) {
        calls.push([
          "verifyLlvmCompatibility",
          baseline.sha256,
          candidate.sha256,
        ]);
        return {
          baselineExports: 100,
          candidateExports: 101,
          soname: candidate.soname,
          needed: candidate.needed,
        };
      },
    },
    inspectElf(path) {
      calls.push(["inspectElf", path]);
      return {
        sha256: hash(ops.read(path, 256 * 1024 ** 2)),
        soname: "libLLVM.so.19.1",
        needed: path.startsWith("/usr/lib/")
          ? ["libxml2.so.2", "libc.so.6"]
          : ["libc.so.6"],
        symbols: "synthetic whole symbols",
      };
    },
    inspectDynamic(path) {
      calls.push(["inspectDynamic", path]);
      return { needed: ["libLLVM.so.19.1"], rpath: null, runpath: null };
    },
    decode,
    extract(raw, root, entries) {
      calls.push(["extract", root]);
      assert.equal(root, "/tmp/vaettir-fresh-final-" + expected.verificationId);
      for (const [path, bytes] of inspectFinalDebianPackage(raw, decode)
        .contents)
        files.set(root + "/" + path, bytes);
      return structuredClone(entries);
    },
    runProbe(request) {
      calls.push(["runProbe", request]);
      return request.path === "/build/llvm-arm-policy"
        ? arm
        : Buffer.from("VAETTIR_LLVM_CPU_JIT_ADD_4_7=11\n");
    },
    readFinalLog(max) {
      calls.push(["readFinalLog", max]);
      return rawLog;
    },
  };
  function rebindFinal(transform) {
    const path = "/build/llvm-phase-receipts/final.json",
      value = JSON.parse(files.get(path));
    transform(value);
    const raw = put(path, value);
    expected.receipts.at(-1).sha256 = hash(raw);
  }
  function repackage(transformControl = () => {}, transformData = () => {}) {
    transformControl(controlEntries);
    transformData(dataEntries);
    put(packagePath, deb(controlEntries, dataEntries));
    rebindFinal((value) => {
      value.proof.packageSha256 = hash(files.get(packagePath));
    });
  }
  function rebindInputs() {
    expected.inputs.configuration = ["llvm-build", "llvm-assert-build"].map(
      (name) => ({
        cache: hash(files.get(`/build/${name}/CMakeCache.txt`)),
        commands: hash(files.get(`/build/${name}/compile_commands.json`)),
      }),
    );
    let previous = null;
    for (const pin of expected.receipts) {
      const path = `/build/llvm-phase-receipts/${pin.phase}.json`,
        value = JSON.parse(files.get(path));
      value.inputs = expected.inputs;
      value.inputsSha256 = hash(JSON.stringify(expected.inputs));
      value.predecessorSha256 = previous;
      pin.sha256 = hash(put(path, value));
      previous = pin.sha256;
    }
  }
  return {
    expected,
    ops,
    files,
    calls,
    put,
    rawLog,
    controlEntries,
    dataEntries,
    rebindFinal,
    repackage,
    rebindInputs,
  };
}

test("complete synthetic final verifies seven receipts and invokes full inventory/ELF/probe operations", () => {
  const f = fixture(),
    proof = verifyNativeFreshFinalState(f.expected, f.ops);
  assert.equal(proof.receiptChain.length, 7);
  assert.equal(proof.completeInputsAndObjectsRecomputed, true);
  assert.deepEqual(
    proof.units.map((unit) => [
      unit.discovered,
      unit.passed,
      unit.skipped,
      unit.unsupported,
    ]),
    [
      [120, 115, 5, 0],
      [120, 118, 0, 2],
    ],
  );
  assert.equal(proof.runtimeAcceptance, false);
  assert.equal(proof.authenticatedAcceptance, false);
  assert.equal(proof.deploymentAcceptance, false);
  assert.deepEqual(
    f.calls
      .filter((call) => call[0] === "inventoryTree")
      .map((call) => call[1]),
    [
      "/build/scripts",
      "/build/llvm-sources",
      "/build/llvm-source",
      "/build/llvm-build",
      "/build/llvm-assert-build",
    ],
  );
  assert.deepEqual(
    f.calls.find(
      (call) => call[0] === "inventoryTree" && call[1] === "/build/llvm-source",
    )[2].exclude,
    ["debian/libllvm19", "debian/libllvm19.substvars"],
  );
  assert.equal(
    f.calls.filter((call) => call[0] === "verifyLlvmCompatibility").length,
    2,
  );
  for (const [, request] of f.calls.filter((call) => call[0] === "runProbe")) {
    assert.equal(request.timeoutSeconds, 10);
    assert.equal(request.loader, "/lib64/ld-linux-x86-64.so.2");
    assert.deepEqual(request.environment, {
      PATH: "/usr/bin:/bin",
      LC_ALL: "C",
    });
  }
});

test("refuses changed actual generated object state even when all metadata receipts match", () => {
  const f = fixture();
  f.ops.native.inventoryTree = (path) => ({
    ...trees(path),
    ...(path === "/build/llvm-assert-build"
      ? { sha256: hashOf("changed object") }
      : {}),
  });
  assert.throws(
    () => verifyNativeFreshFinalState(f.expected, f.ops),
    /Actual complete object/,
  );
  assert.ok(!f.calls.some((call) => call[0] === "extract"));
});
test("refuses changed full input inventories, script bytes, compiler and active markers", () => {
  for (const mutation of [
    (f) => {
      f.ops.native.inventoryTree = (path) => ({
        ...trees(path),
        ...(path === "/build/llvm-source" ? { bytes: 10001 } : {}),
      });
    },
    (f) => f.put("/build/scripts/check-llvm-jit.c", "mutated code"),
    (f) => {
      f.ops.compiler = () => ({
        ...f.expected.inputs.toolchain,
        compilerPackage: "other",
      });
    },
    (f) => f.put("/build/llvm-phase-active.json", "failed"),
  ]) {
    const f = fixture();
    mutation(f);
    assert.throws(() => verifyNativeFreshFinalState(f.expected, f.ops));
  }
});
test("refuses missing/reordered/foreign receipt chains and unknown fields/acceptance/proof flags", () => {
  for (const mutation of [
    (f) => f.expected.receipts.pop(),
    (f) => f.expected.receipts.reverse(),
    (f) =>
      f.rebindFinal((value) => {
        value.predecessorSha256 = hashOf("foreign phase");
      }),
    (f) =>
      f.rebindFinal((value) => {
        value.runtimeAcceptance = true;
      }),
    (f) =>
      f.rebindFinal((value) => {
        value.proof.extra = hashOf("extra proof");
      }),
    (f) =>
      f.rebindFinal((value) => {
        value.other = true;
      }),
  ]) {
    const f = fixture();
    mutation(f);
    assert.throws(() => verifyNativeFreshFinalState(f.expected, f.ops));
  }
});
test("strict JSON refuses duplicate keys, bad UTF8, trailing data and nested payloads", () => {
  for (const raw of [
    Buffer.from('{"key":1,"key":2}'),
    Buffer.from([0xff]),
    Buffer.from("{} trailing"),
    Buffer.from("[".repeat(34) + "0" + "]".repeat(34)),
  ])
    assert.throws(() => parseFinalJson(raw));
  assert.deepEqual(
    parseFinalJson(Buffer.from('{"quoted":"a\\"b","array":[true,null,3]}')),
    { quoted: 'a"b', array: [true, null, 3] },
  );
});
test("actual command streams refuse missing, reordered, incomplete, failed or duplicated summaries", () => {
  const f = fixture();
  for (const text of [
    f.rawLog
      .toString()
      .replace("--target check-llvm-unit", "--target SomeTests"),
    f.rawLog.toString().replace("Passed : 115", "Passed : 114"),
    f.rawLog.toString().replace("Skipped: 5", "Failed: 5"),
    f.rawLog
      .toString()
      .replace(
        "Total Discovered Tests: 120",
        "Total Discovered Tests: 120\nTotal Discovered Tests: 120",
      ),
    f.rawLog.toString().replace("Skipped: 5", "Made Up: 5"),
  ])
    assert.throws(() => readFinalUnitStreams(Buffer.from(text)));
  assert.throws(() =>
    readFinalUnitStreams(
      Buffer.from(
        f.rawLog.toString().split("+ timeout 7200")[1] + f.rawLog.toString(),
      ),
    ),
  );
});
test("logs and unit gates must bind exact original bytes before package extraction", () => {
  const f = fixture();
  f.ops.readFinalLog = () => Buffer.concat([f.rawLog, Buffer.from("invented")]);
  assert.throws(() => verifyNativeFreshFinalState(f.expected, f.ops));
  assert.ok(!f.calls.some((call) => call[0] === "extract"));
});
test("refuses actual assertion objects entering release config and ABI failures", () => {
  const f = fixture();
  f.ops.native.verifyLlvmCompatibility = () => {
    throw Error("Synthetic weak-vtable/export mismatch");
  };
  assert.throws(
    () => verifyNativeFreshFinalState(f.expected, f.ops),
    /weak-vtable/,
  );
  const second = fixture();
  second.ops.inspectDynamic = () => ({
    needed: ["libLLVM.so.19.1"],
    rpath: "/foreign",
    runpath: null,
  });
  assert.throws(() => verifyNativeFreshFinalState(second.expected, second.ops));
});
test("package raw hash, proof copies, installed-version/source, depends and maintainer programs fail closed", () => {
  for (const mutation of [
    (f) =>
      f.repackage((entries) => {
        entries[0].raw = Buffer.from(
          entries[0].raw
            .toString()
            .replace("1:19.1.7-3+vaettir1", "1:19.1.7-other"),
        );
      }),
    (f) =>
      f.repackage((entries) => {
        entries[0].raw = Buffer.from(
          entries[0].raw
            .toString()
            .replace("Depends: libc6 (>= 2.39)", "Depends: libxml2"),
        );
      }),
    (f) =>
      f.repackage((entries) =>
        entries.push({ path: "postinst", raw: Buffer.from("do not execute") }),
      ),
    (f) =>
      f.repackage(undefined, (entries) => {
        entries.find((entry) => entry.path.endsWith("llvm-abi.json")).raw =
          json({ forged: true });
      }),
  ]) {
    const f = fixture();
    mutation(f);
    assert.throws(() => verifyNativeFreshFinalState(f.expected, f.ops));
    assert.ok(!f.calls.some((call) => call[0] === "extract"));
  }
});
test("package parser refuses traversal, duplicates, symlink parents/escapes, special modes and corruption", () => {
  for (const mutation of [
    (entries) =>
      entries.push({ path: "../../escape", raw: Buffer.from("bad") }),
    (entries) => entries.push({ ...entries[0] }),
    (entries) =>
      entries.push({
        path: "usr/share/doc/libllvm19/escape",
        kind: "symlink",
        link: "../../../escape",
      }),
    (entries) => {
      entries[0].mode = 0o4755;
    },
    (entries) => {
      entries[1].link = "/absolute";
    },
    (entries) =>
      entries.push({
        path: "usr/share/doc/libllvm19/copyright/child",
        raw: Buffer.from("bad"),
      }),
  ]) {
    const f = fixture();
    mutation(f.dataEntries);
    assert.throws(() =>
      inspectFinalDebianPackage(deb(f.controlEntries, f.dataEntries), decode),
    );
  }
  const f = fixture(),
    raw = deb(f.controlEntries, f.dataEntries);
  raw[2] ^= 1;
  assert.throws(() => inspectFinalDebianPackage(raw, decode));
});
test("extraction refuses pre-existing root, changed inventory and candidate or probe discrepancies", () => {
  for (const mutation of [
    (f) =>
      f.put(
        "/tmp/vaettir-fresh-final-" + f.expected.verificationId,
        "unrelated directory",
      ),
    (f) => {
      const original = f.ops.extract;
      f.ops.extract = (...args) => original(...args).slice(1);
    },
    (f) => {
      f.ops.runProbe = () => Buffer.from("invented ARM/JIT");
    },
  ]) {
    const f = fixture();
    mutation(f);
    assert.throws(() => verifyNativeFreshFinalState(f.expected, f.ops));
  }
});
test("expected adapter and scope cannot grow arbitrary paths/fields or source pins", () => {
  for (const mutation of [
    (f) => {
      f.expected.path = "/elsewhere";
    },
    (f) => {
      f.expected.scriptPins.extra = hashOf("extra");
    },
    (f) => {
      f.ops.eagerInstall = () => {};
    },
    (f) => {
      f.expected.verificationId = "../unowned";
    },
  ]) {
    const f = fixture();
    mutation(f);
    assert.throws(() => verifyNativeFreshFinalState(f.expected, f.ops));
  }
});

test("generated import-free callable executes the complete synthetic verification in trusted Node realm", () => {
  const source = nativeFreshFinalVerifierProgram();
  assert.ok(!source.includes("import ") && !source.includes("require("));
  const verifier = new Script(source, {
    filename: "synthetic-pinned-final-verifier.vm",
  }).runInThisContext()({ assert, createHash, posix, Buffer, TextDecoder });
  const f = fixture();
  assert.deepEqual(
    verifier.verifyNativeFreshFinalState(f.expected, f.ops),
    verifyNativeFreshFinalState(f.expected, fixture().ops),
  );
  const failed = fixture();
  failed.ops.native.inventoryTree = (path) => ({
    ...trees(path),
    bytes: 20000,
  });
  assert.throws(() =>
    verifier.verifyNativeFreshFinalState(failed.expected, failed.ops),
  );
});

test("policy inspection refuses wrong or duplicate generated flags even after full input receipts rebind", () => {
  for (const mutation of [
    (f) =>
      f.put(
        "/build/llvm-build/CMakeCache.txt",
        f.files.get("/build/llvm-build/CMakeCache.txt").toString() +
          "LLVM_ENABLE_ASSERTIONS:BOOL=ON\n",
      ),
    (f) => {
      const path = "/build/llvm-build/compile_commands.json",
        values = JSON.parse(f.files.get(path));
      values[0].command += " -UNDEBUG";
      f.put(path, values);
    },
    (f) => {
      const path = "/build/llvm-assert-build/compile_commands.json",
        values = JSON.parse(f.files.get(path));
      values[0].command = values[0].command.replace("-UNDEBUG", "-DNDEBUG");
      f.put(path, values);
    },
    (f) =>
      f.put(
        "/build/llvm-assert-build/include/llvm/Config/abi-breaking.h",
        "#define LLVM_ENABLE_ABI_BREAKING_CHECKS 1\n",
      ),
  ]) {
    const f = fixture();
    mutation(f);
    f.rebindInputs();
    assert.throws(() => verifyNativeFreshFinalState(f.expected, f.ops));
    assert.ok(!f.calls.some((call) => call[0] === "extract"));
  }
});

test("unit boolean metadata is insufficient despite freshly rebound proof hash", () => {
  const f = fixture(),
    raw = f.put("/build/llvm-final-unit-gates.json", {
      schemaVersion: 1,
      releaseTarget: "check-llvm-unit",
      assertionTarget: "SomeTests",
      releasePassed: true,
      assertionPassed: true,
    });
  f.rebindFinal((value) => {
    value.proof.unitReceiptSha256 = hash(raw);
  });
  assert.throws(() => verifyNativeFreshFinalState(f.expected, f.ops));
});

test("archive control bytes, compressed content, checksum and declared expansion cannot hide mutations", () => {
  const f = fixture(),
    raw = deb(f.controlEntries, f.dataEntries);
  const highBit = Buffer.from(raw);
  highBit[8] |= 128;
  assert.throws(() => inspectFinalDebianPackage(highBit, decode), /Non-ASCII/);
  assert.throws(
    () => inspectFinalDebianPackage(raw, () => Buffer.alloc(512)),
    /Malformed|assert|false|Unsupported/i,
  );
  const control = tar(f.controlEntries);
  control[0] ^= 1;
  assert.throws(
    () =>
      inspectFinalDebianPackage(
        ar([
          ["debian-binary", Buffer.from("2.0\n")],
          ["control.tar.gz", gzipSync(control)],
          ["data.tar.gz", gzipSync(tar(f.dataEntries))],
        ]),
        decode,
      ),
    /checksum/,
  );
  assert.throws(() =>
    inspectFinalDebianPackage(
      ar([
        ["debian-binary", Buffer.from("2.0\n")],
        ["control.tar.gz", Buffer.from("not gzip")],
        ["data.tar.gz", gzipSync(tar(f.dataEntries))],
      ]),
      decode,
    ),
  );
});

test("well-checksummed tar numeric fields refuse non-padding after NUL", () => {
  const f = fixture();
  for (const [offset, width] of [
    [100, 8],
    [108, 8],
    [116, 8],
    [124, 12],
  ]) {
    for (const suffix of ["x", "7", "\t"]) {
      const control = tar(f.controlEntries);
      control.fill(0, offset, offset + width);
      control.write("0\0" + suffix, offset, "ascii");
      control.fill(32, 148, 156);
      const checksum = control
        .subarray(0, 512)
        .reduce((sum, byte) => sum + byte, 0);
      control.write(
        checksum.toString(8).padStart(6, "0") + "\0 ",
        148,
        8,
        "ascii",
      );
      assert.throws(
        () =>
          inspectFinalDebianPackage(
            ar([
              ["debian-binary", Buffer.from("2.0\n")],
              ["control.tar.gz", gzipSync(control)],
              ["data.tar.gz", gzipSync(tar(f.dataEntries))],
            ]),
            decode,
          ),
        /Ambiguous archive numeric padding/,
      );
    }
  }
  const control = tar(f.controlEntries);
  control[155] = 120;
  assert.throws(
    () =>
      inspectFinalDebianPackage(
        ar([
          ["debian-binary", Buffer.from("2.0\n")],
          ["control.tar.gz", gzipSync(control)],
          ["data.tar.gz", gzipSync(tar(f.dataEntries))],
        ]),
        decode,
      ),
    /Ambiguous archive numeric padding/,
  );
  // Standard checksum NUL/space padding and zero-filled numeric endings remain supported.
  assert.doesNotThrow(() =>
    inspectFinalDebianPackage(deb(f.controlEntries, f.dataEntries), decode),
  );
});

test("ARM record/probe, candidate hashes and extra phase files refuse metadata-only completion", () => {
  for (const mutation of [
    (f) => f.put("/build/llvm-arm-candidate.txt", "missing33vectors\n"),
    (f) => {
      f.ops.native.hashCandidateLibrary = () => ({
        sha256: hashOf("foreign candidate"),
        bytes: 20,
      });
    },
    (f) => {
      const list = f.ops.list;
      f.ops.list = (path) =>
        path.endsWith("phase-receipts")
          ? [...list(path), "unapproved.json"]
          : list(path);
    },
    (f) => {
      const run = f.ops.runProbe;
      f.ops.runProbe = (request) =>
        request.path.endsWith("cpu-jit")
          ? Buffer.from("VAETTIR_LLVM_CPU_JIT_ADD_4_7=12\n")
          : run(request);
    },
  ]) {
    const f = fixture();
    mutation(f);
    assert.throws(() => verifyNativeFreshFinalState(f.expected, f.ops));
  }
});
