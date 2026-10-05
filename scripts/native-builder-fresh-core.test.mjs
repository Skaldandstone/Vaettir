// Synthetic byte/VM/Bash-syntax tests only. These receipts do not describe any
// actual build. No Git/AWS/Docker/native work is invoked by this test module.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Script, createContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { historicalNativeV1RecipeFixture } from "./native-v1-recipe-test-fixture.mjs";
import {
  planNativeFreshPrepare,
  FRESH_NATIVE_SCRIPT_LF_HASHES,
  unpackFreshPrepareOperation,
} from "./native-builder-fresh-prepare.mjs";
import {
  planNativeFreshCore,
  validateNativeFreshCoreCompleted,
} from "./native-builder-fresh-core.mjs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const encode = (x) => Buffer.from(JSON.stringify(x) + "\n");
const commit = "a".repeat(40),
  prefix = "native-fresh-core-proof/";
const falseFlags = {
  unitAcceptance: false,
  packageAcceptance: false,
  runtimeAcceptance: false,
  authenticatedAcceptance: false,
  deploymentAcceptance: false,
};
function zip(entries) {
  const local = [],
    central = [];
  let offset = 0;
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let n = 0; n < 8; n++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (const [name, bytes] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name),
      header = Buffer.alloc(30),
      dir = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    dir.writeUInt32LE(0x02014b50);
    dir.writeUInt16LE(0x0314, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc32(bytes), 16);
    dir.writeUInt32LE(bytes.length, 20);
    dir.writeUInt32LE(bytes.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE((parseInt("100644", 8) * 65536) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    local.push(header, nameBytes, bytes);
    central.push(dir, nameBytes);
    offset += header.length + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22),
    comment = Buffer.from(commit);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...local, directory, end, comment]);
}
function fixture() {
  const gitBlobs = {},
    gitExports = {},
    gitModes = {},
    entries = {};
  for (const name of [
    ...Object.keys(FRESH_NATIVE_SCRIPT_LF_HASHES),
    "Dockerfile.api",
  ]) {
    const path = name === "Dockerfile.api" ? name : "scripts/" + name;
    const raw = readFileSync(new URL("../" + path, import.meta.url));
    // Historical v1 SYNTHETIC bytes, never a current canonical Git export.
    const bytes = name === "build-llvm-runtime.sh"
      ? historicalNativeV1RecipeFixture(raw).bytes
      : Buffer.from(raw.toString("utf8").replaceAll("\r\n", "\n"));
    gitBlobs[name] = bytes;
    gitModes[name] = "100644";
    gitExports[name] =
      name === "Dockerfile.api" ? bytes : zip({ [path]: bytes });
    entries[path] = bytes;
  }
  const archive = zip(entries),
    preparePlan = planNativeFreshPrepare({
      sourceCommit: commit,
      archive,
      archiveSha256: hash(archive),
      gitBlobs,
      gitExports,
      gitModes,
      budget: {
        mode: "bounded-probe",
        prepareSeconds: 1785,
        verificationSeconds: 240,
        pushSeconds: 180,
        totalSeconds: 2520,
      },
    });
  const inventory = { sha256: "b".repeat(64), entries: 10, bytes: 10000 };
  const inputs = {
    scripts: { ...inventory, entries: 9 },
    signedSources: { ...inventory },
    source: { ...inventory },
    toolchain: {
      compilerSha256: "c".repeat(64),
      compiler: "Debian clang version 19.1.7 (3+b1)\n",
      compilerPackage: "1:19.1.7-3+b1",
      installedPackagesSha256: "d".repeat(64),
    },
    baselineSha256: "e".repeat(64),
    configuration: [
      { cache: "f".repeat(64), commands: "1".repeat(64) },
      { cache: "2".repeat(64), commands: "3".repeat(64) },
    ],
    assertionPlanSha256: "4".repeat(64),
  };
  const prepareReceipt = {
    schemaVersion: 1,
    purpose: "llvm-builder-checkpoint-not-runtime",
    phase: "prepare",
    predecessorSha256: null,
    inputs,
    inputsSha256: hash(JSON.stringify(inputs)),
    state: { release: { ...inventory }, assertions: { ...inventory } },
    proof: {},
    ...falseFlags,
  };
  const receiptBytes = encode(prepareReceipt);
  const labels = {
    "vaettir.source-commit": commit,
    "vaettir.source-sha256": preparePlan.identity.sourceSha256,
    "vaettir.prepare-plan": preparePlan.planSha256,
    "vaettir.runtime-eligible": "false",
    "vaettir.artifact-purpose": "llvm-builder-checkpoint",
  };
  const config = encode({
      os: "linux",
      architecture: "amd64",
      config: { Labels: labels },
      rootfs: { type: "layers", diff_ids: ["sha256:" + "5".repeat(64)] },
    }),
    imageConfigDigest = "sha256:" + hash(config);
  const imageManifest = JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: { digest: imageConfigDigest },
      layers: [{ digest: "sha256:" + "6".repeat(64), size: 1000 }],
    }),
    imageDigest = "sha256:" + hash(imageManifest);
  const proof = {
    schemaVersion: 1,
    purpose: "fresh-native-prepare-actual-state",
    planSha256: preparePlan.planSha256,
    sourceCommit: commit,
    sourceSha256: preparePlan.identity.sourceSha256,
    receiptSha256: hash(receiptBytes),
    receiptBase64: receiptBytes.toString("base64"),
    inputsSha256: prepareReceipt.inputsSha256,
    sourceManifestSha256: hash("synthetic public source manifest"),
    actualStateVerified: true,
    imageDigest,
    imageConfigDigest,
    imageSizeBytes: 10000,
    prePushInspection: true,
    digestPullEvidence: false,
    compiledAcceptance: false,
    ...falseFlags,
  };
  const expectedPrepare = {
    buildId: "vaettir-api-build:11111111-2222-3333-4444-555555555555",
    planSha256: preparePlan.planSha256,
    requestSha256: preparePlan.requestSha256,
    buildspecSha256: preparePlan.buildspecSha256,
    imageDigest,
    imageConfigDigest,
    receiptSha256: proof.receiptSha256,
  };
  const completedPrepare = {
    schemaVersion: 1,
    purpose: "completed-fresh-native-prepare",
    status: "SUCCEEDED",
    ...expectedPrepare,
    sourceCommit: commit,
    sourceSha256: preparePlan.identity.sourceSha256,
    proof,
    registryManifest: {
      failures: [],
      images: [
        {
          imageId: { imageDigest, imageTag: preparePlan.candidateTag },
          imageManifest,
        },
      ],
    },
    registryConfigBase64: config.toString("base64"),
    compiledAcceptance: false,
    ...falseFlags,
  };
  const input = {
    completedPrepare,
    expectedPrepare,
    preparePlan,
    budget: {
      mode: "bounded-probe",
      compileSeconds: 2100,
      postCompileReserveSeconds: 180,
      totalSeconds: 2520,
    },
  };
  const plan = planNativeFreshCore(input);
  const abi = {
    soname: "libLLVM.so.19.1",
    runtimeAccepted: false,
    baselineSha256: inputs.baselineSha256,
    candidateSha256: "7".repeat(64),
    baselineExports: 51988,
    candidateExports: 51988,
  };
  const abiBytes = encode(abi),
    coreReceipt = {
      ...prepareReceipt,
      phase: "release-core",
      predecessorSha256: proof.receiptSha256,
      state: {
        release: { ...inventory, sha256: "8".repeat(64) },
        assertions: { ...inventory },
      },
      proof: { abiReceiptSha256: hash(abiBytes) },
    };
  const coreBytes = encode(coreReceipt),
    coreProof = {
      schemaVersion: 1,
      purpose: "fresh-native-core-phase-evidence",
      planSha256: plan.planSha256,
      sourceCommit: commit,
      sourceSha256: preparePlan.identity.sourceSha256,
      predecessorImageDigest: imageDigest,
      predecessorReceiptSha256: proof.receiptSha256,
      receiptSha256: hash(coreBytes),
      receiptBase64: coreBytes.toString("base64"),
      inputsSha256: inputs && prepareReceipt.inputsSha256,
      candidateSha256: abi.candidateSha256,
      abiReceiptSha256: hash(abiBytes),
      abiReceiptBase64: abiBytes.toString("base64"),
      ...falseFlags,
    };
  const coreLabels = {
    ...labels,
    "vaettir.continuation-plan": plan.planSha256,
  };
  const coreConfig = encode({
      os: "linux",
      architecture: "amd64",
      config: { Labels: coreLabels },
      rootfs: { type: "layers", diff_ids: ["sha256:" + "9".repeat(64)] },
    }),
    coreConfigDigest = "sha256:" + hash(coreConfig);
  const coreManifest = JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: { digest: coreConfigDigest },
      layers: [{ digest: "sha256:" + "0".repeat(64), size: 2000 }],
    }),
    coreImageDigest = "sha256:" + hash(coreManifest);
  const expected = {
    buildId: "vaettir-api-build:22222222-3333-4444-5555-666666666666",
    planSha256: plan.planSha256,
    requestSha256: plan.requestSha256,
    buildspecSha256: plan.buildspecSha256,
    imageDigest: coreImageDigest,
    imageConfigDigest: coreConfigDigest,
    receiptSha256: coreProof.receiptSha256,
  };
  const completed = {
    schemaVersion: 1,
    purpose: "completed-fresh-native-core",
    status: "SUCCEEDED",
    ...expected,
    sourceCommit: commit,
    sourceSha256: plan.identity.sourceSha256,
    proof: {
      ...coreProof,
      imageDigest: coreImageDigest,
      imageConfigDigest: coreConfigDigest,
      imageSizeBytes: 20000,
      actualStateVerified: true,
      prePushInspection: true,
      digestPullEvidence: false,
    },
    receiptChain: [
      {
        phase: "prepare",
        sha256: proof.receiptSha256,
        base64: proof.receiptBase64,
      },
      {
        phase: "release-core",
        sha256: coreProof.receiptSha256,
        base64: coreProof.receiptBase64,
      },
    ],
    registryManifest: {
      failures: [],
      images: [
        {
          imageId: {
            imageDigest: coreImageDigest,
            imageTag: plan.candidateTag,
          },
          imageManifest: coreManifest,
        },
      ],
    },
    registryConfigBase64: coreConfig.toString("base64"),
    ...falseFlags,
  };
  const files = Object.fromEntries(
    Object.keys(FRESH_NATIVE_SCRIPT_LF_HASHES).map((n) => [
      "/build/scripts/" + n,
      gitBlobs[n],
    ]),
  );
  Object.assign(files, {
    "/build/llvm-phase-receipts/prepare.json": receiptBytes,
    "/build/llvm-phase-receipts/release-core.json": coreBytes,
    "/build/llvm-sources/source-manifest.json": Buffer.from(
      "synthetic public source manifest",
    ),
    "/build/llvm-early-abi.json": abiBytes,
  });
  return {
    input,
    plan,
    completed,
    expected,
    prepareReceipt,
    coreReceipt,
    coreProof,
    coreBytes,
    files,
    labels,
    coreLabels,
  };
}
const requireNative = createRequire(import.meta.url);
function virtual(program, files = {}, extra = {}) {
  const storage = new Map(
      Object.entries(files).map(([k, v]) => [
        k,
        Buffer.isBuffer(v) ? v : Buffer.from(v),
      ]),
    ),
    printed = [],
    calls = [];
  let realmParse;
  const fs = {
    lstatSync: (p) => {
      assert.ok(storage.has(p), "synthetic file required: " + p);
      return {
        size: storage.get(p).length,
        isFile: () => true,
        isSymbolicLink: () => false,
      };
    },
    readFileSync: (p) => storage.get(p),
    existsSync: (p) => storage.has(p),
    readdirSync: (p) =>
      realmParse(
        JSON.stringify(
          [...storage.keys()]
            .filter(
              (k) =>
                k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/"),
            )
            .map((k) => k.slice(p.length + 1)),
        ),
      ),
    writeFileSync: (p, b, o) => {
      assert.equal(o.flag, "wx");
      assert.equal(storage.has(p), false);
      storage.set(p, Buffer.from(b));
    },
    statfsSync: () => ({ bavail: 80n * 1024n ** 3n, bsize: 1n }),
  };
  const context = createContext({
    Buffer,
    TextDecoder,
    console: { log: (x) => printed.push(x), error: (x) => printed.push(x) },
    process: {
      execPath: "node",
      env: { VAETTIR_RELEASE_COMMIT: commit },
      hrtime: { bigint: () => 1000n * 1000000000n },
      stdout: { write: (x) => printed.push(x) },
    },
    ...extra,
    require: (name) => {
      if (name === "node:fs") return fs;
      if (name === "node:child_process")
        return {
          spawnSync: (...args) => {
            calls.push(args);
            return { status: 0, signal: null };
          },
          execFileSync: (...args) => {
            calls.push(args);
            return "5\n";
          },
        };
      assert.ok(
        ["node:assert/strict", "node:crypto", "node:zlib"].includes(name),
      );
      return requireNative(name);
    },
  });
  realmParse = new Script("JSON.parse").runInContext(context);
  return {
    storage,
    printed,
    calls,
    run: () => new Script(program).runInContext(context, { timeout: 2000 }),
  };
}

test("synthetic fresh parent produces deterministic pure core request, never native acceptance", () => {
  const f = fixture(),
    p = f.plan;
  assert.deepEqual(p, planNativeFreshCore(f.input));
  assert.equal(p.request.projectName, "vaettir-api-build");
  assert.equal(p.request.autoRetryLimitOverride, 0);
  assert.equal(p.request.timeoutInMinutesOverride, 45);
  assert.equal(p.request.computeTypeOverride, "BUILD_GENERAL1_LARGE");
  assert.equal(
    p.importedImage,
    "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api@" +
      f.input.expectedPrepare.imageDigest,
  );
  assert.equal(p.identity.inputsSha256, f.prepareReceipt.inputsSha256);
  assert.equal(p.identity.resources.compilerJobs, 5);
  assert.equal(p.identity.resources.memoryBytes, 14 * 1024 ** 3);
  assert.equal(p.identity.resources.cpus, 8);
  assert.equal(p.requestSha256, hash(JSON.stringify(p.request)));
  assert.equal(p.buildspecSha256, hash(p.request.buildspecOverride));
  assert.equal(p.dispatchRequiresRootPreflight, true);
  assert.equal(p.globalDeadlineMayRefuse, true);
  for (const k of [
    "compileAcceptance",
    "defaultRuntimeGraphChanged",
    "forecastAcceptance",
    ...Object.keys(falseFlags),
  ])
    assert.equal(p[k], false);
});
test("old or unverified prepare, mixed source, unknown controls and altered plan refused before operation", () => {
  for (const mutate of [
    (x) => (x.completedPrepare.status = "FAILED"),
    (x) => (x.completedPrepare.proof.actualStateVerified = false),
    (x) =>
      (x.expectedPrepare.receiptSha256 =
        "54e96393c398f6a97f49f570de04fa758f18121aa2ebe90595f40ba29e38b09b"),
    (x) => (x.completedPrepare.sourceCommit = "b".repeat(40)),
    (x) => (x.preparePlan.operation += "; injected"),
    (x) => (x.phase = "final"),
    (x) => (x.budget.compilerJobs = 1),
    (x) =>
      (x.preparePlan.identity.expectedScripts["native-llvm-checkpoint.mjs"] =
        "0".repeat(64)),
  ]) {
    const f = fixture();
    mutate(f.input);
    assert.throws(() => planNativeFreshCore(f.input));
  }
});
test("bounded probe is feasible only with explicit reserves, not summing invented timing forecasts", () => {
  const f = fixture(),
    r = f.plan.identity.resources;
  assert.equal(r.operationSeconds, 2445);
  assert.equal(r.cleanupGraceSeconds, 75);
  assert.equal(r.decoderWatchdogSeconds, 2550);
  assert.ok(r.operationSeconds + r.cleanupGraceSeconds <= 2520);
  for (const mutate of [
    (b) => (b.mode = "measured"),
    (b) => (b.compileSeconds = 2101),
    (b) => (b.postCompileReserveSeconds = 119),
    (b) => (b.totalSeconds = 2700),
    (b) => (b.totalSeconds = 2399),
    (b) => (b.compileSeconds = 60.5),
  ]) {
    const x = structuredClone(f.input);
    mutate(x.budget);
    assert.throws(() => planNativeFreshCore(x));
  }
  const shorter = structuredClone(f.input);
  shorter.budget.compileSeconds = 1980;
  assert.equal(
    planNativeFreshCore(shorter).identity.resources.compileSeconds,
    1980,
  );
});
test("22 actual generated JavaScript programs parse, exact gzip decodes and shell is syntax-valid without execution", () => {
  const p = fixture().plan;
  assert.equal(Object.keys(p.generatedPrograms).length, 22);
  for (const [name, program] of Object.entries(p.generatedPrograms))
    assert.doesNotThrow(() => new Script(program), name);
  assert.equal(unpackFreshPrepareOperation(p.transport), p.operation);
  assert.ok(Buffer.byteLength(p.request.buildspecOverride) <= 25600);
  const decoded = virtual(p.generatedPrograms.decoder);
  decoded.run();
  assert.equal(decoded.calls.length, 1);
  assert.equal(decoded.calls[0][0], "/bin/bash");
  assert.equal(decoded.calls[0][1][4], p.operation);
  assert.equal(decoded.calls[0][2].timeout, 2550000);
  const denied = virtual(
    p.generatedPrograms.decoder.replace(
      p.transport.compressedSha256,
      "0".repeat(64),
    ),
  );
  assert.throws(() => denied.run());
  assert.equal(denied.calls.length, 0);
  const binary =
      process.platform === "win32"
        ? "C:/Program Files/Git/bin/bash.exe"
        : "/bin/bash",
    marker = "bash -eu -o pipefail -c ",
    encoded = p.operation.slice(p.operation.indexOf(marker) + marker.length);
  assert.ok(encoded.startsWith("'") && encoded.endsWith("'"));
  const inner = encoded.slice(1, -1).replaceAll("'\\''", "'");
  for (const operation of [p.operation, inner]) {
    const check = spawnSync(binary, ["-n"], {
      input: operation,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(check.status, 0, check.stderr);
  }
});
test("no host auto-extraction/script execution, new IAM, unit/runtime bypass or old donor routes", () => {
  const p = fixture().plan;
  assert.equal(
    JSON.parse(p.request.buildspecOverride).phases.build.commands.length,
    1,
  );
  assert.doesNotMatch(
    p.operation,
    /describe-images|put-object|put-role-policy|update-project|--profile|:latest|docker build|aws s3api|unzip|check-llvm-unit/,
  );
  assert.ok(
    p.operation.includes(
      "sh /build/scripts/build-llvm-runtime.sh --phase release-core --predecessor-sha256 " +
        p.identity.prepareExpected.receiptSha256,
    ),
  );
  assert.ok(p.operation.includes("--memory 14g --cpus 8"));
  assert.ok(p.operation.includes("--memory 2g --cpus 2"));
  assert.ok(
    p.operation.indexOf("core-proof.json") < p.operation.indexOf("docker push"),
  );
  assert.ok(
    p.operation.indexOf("cleanup_native_validation") <
      p.operation.indexOf("docker create"),
  );
});
test("monotonic admission uses actual elapsed time and refuses insufficient remaining reserve", () => {
  const p = fixture().plan,
    start = virtual(p.generatedPrograms.start);
  start.run();
  const b = start.storage.get(prefix + "admission.json");
  assert.equal(b.at(-1), 10);
  const inspected = p.operation.indexOf("compiler-inspect.json");
  const admitted = p.operation.indexOf("Remaining observed deadline");
  const started = p.operation.indexOf("2100s docker start");
  assert.ok(inspected < admitted && admitted < started);
  virtual(p.generatedPrograms.admit, { [prefix + "admission.json"]: b }).run();
  const elapsed = JSON.parse(b);
  elapsed.startedNs = (834n * 1000000000n).toString();
  assert.throws(
    () =>
      virtual(p.generatedPrograms.admit, {
        [prefix + "admission.json"]: encode(elapsed),
      }).run(),
    /Remaining observed/,
  );
  elapsed.startedNs = (1001n * 1000000000n).toString();
  assert.throws(() =>
    virtual(p.generatedPrograms.admit, {
      [prefix + "admission.json"]: encode(elapsed),
    }).run(),
  );
});
test("strict parent manifest and actual digest-pull inspection bind source/config labels and ancestry", () => {
  const f = fixture(),
    p = f.plan,
    parent = f.input.completedPrepare,
    files = {
      [prefix + "parent-manifest.json"]: encode(parent.registryManifest),
      [prefix + "parent-inspect.json"]: encode([
        {
          Id: parent.imageConfigDigest,
          Os: "linux",
          Architecture: "amd64",
          Size: parent.proof.imageSizeBytes,
          RepoDigests: [p.importedImage],
          Config: { Labels: f.labels },
        },
      ]),
    };
  virtual(p.generatedPrograms.parentManifest, files).run();
  virtual(p.generatedPrograms.parentInspect, files).run();
  virtual(p.generatedPrograms.disk).run();
  for (const alter of [
    (x) => (x.RepoDigests = []),
    (x) => (x.Id = "sha256:" + "0".repeat(64)),
    (x) => (x.Config.Labels["vaettir.source-sha256"] = "0".repeat(64)),
    (x) => (x.Architecture = "arm64"),
  ]) {
    const bad = JSON.parse(files[prefix + "parent-inspect.json"]);
    alter(bad[0]);
    assert.throws(() =>
      virtual(p.generatedPrograms.parentInspect, {
        ...files,
        [prefix + "parent-inspect.json"]: encode(bad),
      }).run(),
    );
  }
});
test("pre-compile proof requires exact nine scripts, original receipt/manifest and actual five-job allocator", () => {
  const f = fixture(),
    files = { ...f.files };
  delete files["/build/llvm-phase-receipts/release-core.json"];
  const v = virtual(f.plan.generatedPrograms.pre, files);
  v.run();
  assert.equal(v.calls.length, 1);
  assert.deepEqual(Array.from(v.calls[0][1]), [
    "/build/scripts/native-build-concurrency.mjs",
  ]);
  for (const alter of [
    (x) =>
      (x["/build/scripts/native-llvm-checkpoint.mjs"] =
        Buffer.from("tampered")),
    (x) => (x["/build/llvm-phase-active.json"] = Buffer.from("active")),
    (x) =>
      (x["/build/llvm-sources/source-manifest.json"] =
        Buffer.from("different")),
    (x) =>
      (x["/build/llvm-phase-receipts/release-core.json"] =
        Buffer.from("wrong lineage")),
  ]) {
    const bad = { ...files };
    alter(bad);
    assert.throws(() => virtual(f.plan.generatedPrograms.pre, bad).run());
  }
});
test("candidate body independently hashes library and successor begin verifies unchanged actual state", async () => {
  const f = fixture(),
    hashCalls = [],
    beginCalls = [];
  const hashLibrary = (...args) => {
    hashCalls.push(args);
    return { sha256: f.coreProof.candidateSha256, bytes: 1000 };
  };
  const v = virtual(
    f.plan.generatedPrograms.successorBody +
      ";verifyFreshCoreSuccessor(fixtureStore,fixtureHash)",
    f.files,
    {
      fixtureStore: () => ({ begin: (...args) => beginCalls.push(args) }),
      fixtureHash: hashLibrary,
    },
  );
  await v.run();
  assert.deepEqual(hashCalls, [["/build", "release-core"]]);
  assert.deepEqual(beginCalls, [["release-units", f.coreProof.receiptSha256]]);
  assert.equal(
    JSON.parse(v.printed[0].slice("NATIVE_FRESH_CORE_STATE=".length))
      .actualStateVerified,
    true,
  );
  const bad = virtual(
    f.plan.generatedPrograms.candidateBody +
      ";verifyFreshCoreCandidate(fixtureHash)",
    f.files,
    { fixtureHash: () => ({ sha256: "0".repeat(64), bytes: 1000 }) },
  );
  await assert.rejects(bad.run());
  for (const alter of [
    (x) => (x["/build/llvm-phase-active.json"] = Buffer.from("active")),
    (x) =>
      (x["/build/llvm-phase-receipts/final.json"] = Buffer.from("unaccepted")),
    (x) => (x["/build/llvm-phase-receipts/prepare.json"] = Buffer.from("old")),
  ]) {
    const files = { ...f.files };
    alter(files);
    await assert.rejects(
      virtual(
        f.plan.generatedPrograms.candidateBody +
          ";verifyFreshCoreCandidate(fixtureHash)",
        files,
        { fixtureHash: hashLibrary },
      ).run(),
    );
  }
});
test("actual LF/CRLF collector writes valid JSON newline and rejects duplicate/foreign/receipt markers", () => {
  const f = fixture();
  for (const ending of ["\n", "\r\n"]) {
    const line =
        "NATIVE_FRESH_CORE_PHASE=" + JSON.stringify(f.coreProof) + ending,
      files = {
        [prefix + "compile.log"]: "ordinary" + ending + line,
        [prefix + "release-core.json"]: f.coreBytes,
      };
    const v = virtual(f.plan.generatedPrograms.collect, files);
    v.run();
    const b = v.storage.get(prefix + "core-proof.json");
    assert.equal(b.at(-1), 10);
    assert.deepEqual(JSON.parse(b), f.coreProof);
    assert.throws(() =>
      virtual(f.plan.generatedPrograms.collect, {
        ...files,
        [prefix + "compile.log"]: line + line,
      }).run(),
    );
    assert.throws(() =>
      virtual(f.plan.generatedPrograms.collect, {
        ...files,
        [prefix + "release-core.json"]: Buffer.from("wrong"),
      }).run(),
    );
  }
});
test("readback real log regex binds push and successor markers without claiming candidate digest pull", () => {
  const f = fixture(),
    p = f.plan,
    c = f.completed;
  for (const ending of ["\n", "\r\n"]) {
    const files = {
      [prefix + "candidate-manifest.json"]: encode(c.registryManifest),
      [prefix + "candidate-inspect.json"]: encode([
        {
          Id: c.imageConfigDigest,
          Size: c.proof.imageSizeBytes,
          Os: "linux",
          Architecture: "amd64",
          Config: { Labels: f.coreLabels },
        },
      ]),
      [prefix + "commit-id.txt"]: c.imageConfigDigest + ending,
      [prefix + "push.log"]:
        "ordinary" + ending + "digest: " + c.imageDigest + " size: 42" + ending,
      [prefix + "state.log"]:
        "NATIVE_FRESH_CORE_STATE=" +
        JSON.stringify({
          planSha256: p.planSha256,
          receiptSha256: f.coreProof.receiptSha256,
          candidateSha256: f.coreProof.candidateSha256,
          abiReceiptSha256: f.coreProof.abiReceiptSha256,
          actualStateVerified: true,
          runtimeAcceptance: false,
        }) +
        ending,
      [prefix + "core-proof.json"]: encode(f.coreProof),
      [prefix + "release-core.json"]: f.coreBytes,
    };
    virtual(p.generatedPrograms.candidateInspect, files).run();
    const v = virtual(p.generatedPrograms.readback, files);
    v.run();
    const emitted = JSON.parse(
      v.printed[0].slice("NATIVE_FRESH_CORE_VERIFIED=".length),
    );
    assert.deepEqual(emitted, c.proof);
    for (const change of [
      (x) => (x[prefix + "push.log"] += x[prefix + "push.log"]),
      (x) => (x[prefix + "state.log"] += x[prefix + "state.log"]),
      (x) => (x[prefix + "commit-id.txt"] = "sha256:" + "0".repeat(64)),
    ]) {
      const bad = { ...files };
      change(bad);
      assert.throws(() => virtual(p.generatedPrograms.readback, bad).run());
    }
  }
});
test("ownership CID/image/no-mount checks protect cleanup including partial create failures", () => {
  const f = fixture(),
    p = f.plan,
    id = "8".repeat(64),
    container = {
      Id: id,
      Image: f.input.expectedPrepare.imageConfigDigest,
      Config: {
        Image: p.importedImage,
        Labels: { "vaettir.core-owner": p.planSha256 },
      },
      HostConfig: {
        NetworkMode: "none",
        Privileged: false,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        Memory: 14 * 1024 ** 3,
        NanoCpus: 8e9,
        PidsLimit: 2048,
      },
      Mounts: [],
    };
  const files = {
    [prefix + "container-id"]: id,
    [prefix + "cleanup-image-id"]: container.Image,
    [prefix + "cleanup-inspect.json"]: encode([container]),
    [prefix + "compiler-inspect.json"]: encode([container]),
  };
  virtual(p.generatedPrograms.compilerInspect, files).run();
  virtual(p.generatedPrograms.cleanupOwner, files).run();
  const read = virtual(p.generatedPrograms.readId, files);
  read.run();
  assert.equal(read.printed[0], id);
  virtual(p.generatedPrograms.readId).run();
  for (const alter of [
    (x) => (x.Id = "0".repeat(64)),
    (x) => (x.Image = "sha256:" + "0".repeat(64)),
    (x) => (x.Config.Labels["vaettir.core-owner"] = "0".repeat(64)),
    (x) => (x.Mounts = [{ Source: "/unowned" }]),
  ]) {
    const bad = structuredClone(container);
    alter(bad);
    assert.throws(() =>
      virtual(p.generatedPrograms.cleanupOwner, {
        ...files,
        [prefix + "cleanup-inspect.json"]: encode([bad]),
      }).run(),
    );
  }
  assert.throws(() =>
    virtual(p.generatedPrograms.readId, {
      [prefix + "container-id"]: id + "\n",
    }).run(),
  );
  const reset = virtual(p.generatedPrograms.setParentCleanup);
  reset.run();
  assert.equal(
    reset.storage.get(prefix + "cleanup-image-id").toString(),
    container.Image,
  );
  const successor = {
    ...container,
    Image: f.completed.imageConfigDigest,
    Config: { ...container.Config, Image: f.completed.imageConfigDigest },
    HostConfig: {
      ...container.HostConfig,
      Memory: 2 * 1024 ** 3,
      NanoCpus: 2e9,
      PidsLimit: 128,
    },
  };
  virtual(p.generatedPrograms.verifierInspect, {
    [prefix + "container-id"]: id,
    [prefix + "commit-id.txt"]: f.completed.imageConfigDigest + "\n",
    [prefix + "verifier-inspect.json"]: encode([successor]),
  }).run();
});
test("completed core requires full fresh two-receipt ancestry and registry raw config independently pinned", () => {
  const f = fixture(),
    verified = validateNativeFreshCoreCompleted(
      f.completed,
      f.expected,
      f.plan,
      f.input,
    );
  assert.equal(
    verified.receipt.predecessorSha256,
    f.input.expectedPrepare.receiptSha256,
  );
  assert.equal(verified.actualStateVerified, true);
  assert.equal(verified.runtimeAcceptance, false);
  assert.equal(verified.continuationSupported, false);
});
test("completed failures/tamper/false acceptance/replayed parent/false pull/missing ancestry are refused", () => {
  for (const alter of [
    (f) => (f.completed.status = "FAILED"),
    (f) => (f.completed.proof.actualStateVerified = false),
    (f) => (f.completed.proof.digestPullEvidence = true),
    (f) => (f.completed.proof.candidateSha256 = "0".repeat(64)),
    (f) => (f.completed.proof.abiReceiptBase64 += "="),
    (f) => (f.completed.proof.abiReceiptSha256 = "0".repeat(64)),
    (f) => (f.completed.unitAcceptance = true),
    (f) => (f.completed.proof.receiptBase64 += "="),
    (f) => f.completed.receiptChain.pop(),
    (f) => (f.completed.receiptChain[0].base64 = f.coreProof.receiptBase64),
    (f) =>
      (f.completed.registryConfigBase64 = encode({ os: "linux" }).toString(
        "base64",
      )),
    (f) => (f.expected.receiptSha256 = f.input.expectedPrepare.receiptSha256),
    (f) => (f.plan.request.autoRetryLimitOverride = 1),
    (f) => (f.completed.secret = "unsupported"),
    (f) => (f.completed.proof.imageSizeBytes = 64 * 1024 ** 3),
    (f) => (f.completed.registryManifest.images[0].imageManifest += " "),
  ]) {
    const f = fixture();
    alter(f);
    assert.throws(() =>
      validateNativeFreshCoreCompleted(
        f.completed,
        f.expected,
        f.plan,
        f.input,
      ),
    );
  }
});
test("registry configuration platform/labels/rootfs changes refused even with recomputed external hashes", () => {
  for (const alter of [
    (c) => (c.os = "windows"),
    (c) => (c.architecture = "arm64"),
    (c) => (c.rootfs.diff_ids = []),
    (c) => (c.config.Labels["vaettir.source-commit"] = "b".repeat(40)),
    (c) => (c.config.Labels["vaettir.continuation-plan"] = "0".repeat(64)),
    (c) => (c.config.Labels["vaettir.runtime-eligible"] = "true"),
  ]) {
    const f = fixture(),
      config = JSON.parse(
        Buffer.from(f.completed.registryConfigBase64, "base64"),
      );
    alter(config);
    const raw = encode(config),
      configDigest = "sha256:" + hash(raw),
      image = f.completed.registryManifest.images[0],
      manifest = JSON.parse(image.imageManifest);
    manifest.config.digest = configDigest;
    image.imageManifest = JSON.stringify(manifest);
    const imageDigest = "sha256:" + hash(image.imageManifest);
    image.imageId.imageDigest = imageDigest;
    f.completed.registryConfigBase64 = raw.toString("base64");
    for (const x of [f.completed, f.completed.proof, f.expected]) {
      x.imageDigest = imageDigest;
      x.imageConfigDigest = configDigest;
    }
    assert.throws(() =>
      validateNativeFreshCoreCompleted(
        f.completed,
        f.expected,
        f.plan,
        f.input,
      ),
    );
  }
});

test("ABI semantics refuse forged candidate, SONAME, baseline, count or runtime claim even with new matching receipt hash", () => {
  for (const alter of [
    (a) => (a.candidateSha256 = "0".repeat(64)),
    (a) => (a.baselineSha256 = "0".repeat(64)),
    (a) => (a.soname = "libLLVM.so.20"),
    (a) => (a.runtimeAccepted = true),
    (a) => (a.baselineExports = 0),
    (a) => (a.candidateExports = 51987),
  ]) {
    const f = fixture();
    const abi = JSON.parse(
      Buffer.from(f.completed.proof.abiReceiptBase64, "base64"),
    );
    alter(abi);
    const bytes = encode(abi),
      abiHash = hash(bytes);
    f.coreReceipt.proof.abiReceiptSha256 = abiHash;
    const receiptBytes = encode(f.coreReceipt),
      receiptHash = hash(receiptBytes);
    f.completed.proof.abiReceiptBase64 = bytes.toString("base64");
    f.completed.proof.abiReceiptSha256 = abiHash;
    f.completed.proof.receiptBase64 = receiptBytes.toString("base64");
    f.completed.proof.receiptSha256 = receiptHash;
    f.completed.receiptSha256 = receiptHash;
    f.expected.receiptSha256 = receiptHash;
    f.completed.receiptChain[1] = {
      phase: "release-core",
      sha256: receiptHash,
      base64: receiptBytes.toString("base64"),
    };
    assert.throws(() =>
      validateNativeFreshCoreCompleted(
        f.completed,
        f.expected,
        f.plan,
        f.input,
      ),
    );
  }
});

test("forged successor candidate or ABI hash cannot satisfy emitted post-push proof", () => {
  for (const key of ["candidateSha256", "abiReceiptSha256"]) {
    const f = fixture(),
      p = f.plan,
      c = f.completed;
    const state = {
      planSha256: p.planSha256,
      receiptSha256: f.coreProof.receiptSha256,
      candidateSha256: f.coreProof.candidateSha256,
      abiReceiptSha256: f.coreProof.abiReceiptSha256,
      actualStateVerified: true,
      runtimeAcceptance: false,
    };
    state[key] = "0".repeat(64);
    const files = {
      [prefix + "candidate-manifest.json"]: encode(c.registryManifest),
      [prefix + "candidate-inspect.json"]: encode([
        { Id: c.imageConfigDigest, Size: c.proof.imageSizeBytes },
      ]),
      [prefix + "commit-id.txt"]: c.imageConfigDigest + "\n",
      [prefix + "push.log"]: "digest: " + c.imageDigest + " size: 42\n",
      [prefix + "state.log"]:
        "NATIVE_FRESH_CORE_STATE=" + JSON.stringify(state) + "\n",
      [prefix + "core-proof.json"]: encode(f.coreProof),
      [prefix + "release-core.json"]: f.coreBytes,
    };
    assert.throws(() => virtual(p.generatedPrograms.readback, files).run());
  }
});

test("tag absence, committed identity and verifier cleanup setters operate on exact bounded bytes", () => {
  const f = fixture(),
    p = f.plan;
  const absence = {
    images: [],
    failures: [
      { failureCode: "ImageNotFound", imageId: { imageTag: p.candidateTag } },
    ],
  };
  virtual(p.generatedPrograms.absent, {
    [prefix + "tag-preflight.json"]: encode(absence),
  }).run();
  absence.images = [{}];
  assert.throws(() =>
    virtual(p.generatedPrograms.absent, {
      [prefix + "tag-preflight.json"]: encode(absence),
    }).run(),
  );
  const files = {
    [prefix + "commit-id.txt"]: f.completed.imageConfigDigest + "\r\n",
  };
  const read = virtual(p.generatedPrograms.readCommitId, files);
  read.run();
  assert.equal(read.printed[0], f.completed.imageConfigDigest);
  const set = virtual(p.generatedPrograms.setCandidateCleanup, files);
  set.run();
  assert.equal(
    set.storage.get(prefix + "cleanup-image-id").toString(),
    f.completed.imageConfigDigest,
  );
  assert.throws(() =>
    virtual(p.generatedPrograms.readCommitId, {
      [prefix + "commit-id.txt"]: Buffer.alloc(81),
    }).run(),
  );
});

test("ABI and config malformed JSON refuse without leaking unrelated synthetic bytes", () => {
  const sentinel = "SYNTHETIC_PRIVATE_METADATA_MUST_NOT_APPEAR";
  for (const kind of ["abi", "config"]) {
    const f = fixture(),
      raw = Buffer.from('{"Env":["' + sentinel + '"],');
    if (kind === "abi") {
      const abiHash = hash(raw);
      f.coreReceipt.proof.abiReceiptSha256 = abiHash;
      const r = encode(f.coreReceipt),
        rh = hash(r);
      Object.assign(f.completed.proof, {
        abiReceiptBase64: raw.toString("base64"),
        abiReceiptSha256: abiHash,
        receiptBase64: r.toString("base64"),
        receiptSha256: rh,
      });
      f.completed.receiptSha256 = rh;
      f.expected.receiptSha256 = rh;
      f.completed.receiptChain[1] = {
        phase: "release-core",
        sha256: rh,
        base64: r.toString("base64"),
      };
    } else {
      const configDigest = "sha256:" + hash(raw),
        image = f.completed.registryManifest.images[0],
        manifest = JSON.parse(image.imageManifest);
      manifest.config.digest = configDigest;
      image.imageManifest = JSON.stringify(manifest);
      const imageDigest = "sha256:" + hash(image.imageManifest);
      image.imageId.imageDigest = imageDigest;
      f.completed.registryConfigBase64 = raw.toString("base64");
      for (const x of [f.completed, f.completed.proof, f.expected]) {
        x.imageDigest = imageDigest;
        x.imageConfigDigest = configDigest;
      }
    }
    assert.throws(
      () =>
        validateNativeFreshCoreCompleted(
          f.completed,
          f.expected,
          f.plan,
          f.input,
        ),
      (error) => {
        assert.doesNotMatch(error.message, new RegExp(sentinel));
        assert.match(
          error.message,
          /Unsupported .*receipt|Unsupported registry configuration/,
        );
        return true;
      },
    );
  }
});
