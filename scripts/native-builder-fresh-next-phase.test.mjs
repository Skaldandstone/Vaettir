// Synthetic byte/VM/Bash-syntax tests only. These receipts do not describe any
// actual build. Only one owned synthetic Python import fixture performs local
// filesystem/subprocess work; no Git/AWS/Docker/native work is invoked.
import test from "node:test";
import {
  planNativeFreshNextPhase,
  validateNativeFreshNextPhaseCompleted,
  encodeNativeFreshPhaseLog,
  reassembleNativeFreshPhaseLog,
} from "./native-builder-fresh-next-phase.mjs";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { Script, createContext } from "node:vm";
import { spawnSync } from "node:child_process";
import {
  planNativeFreshPrepare,
  FRESH_NATIVE_SCRIPT_LF_HASHES,
  unpackFreshPrepareOperation,
} from "./native-builder-fresh-prepare.mjs";
import { planNativeFreshCore } from "./native-builder-fresh-core.mjs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const encode = (x) => Buffer.from(JSON.stringify(x) + "\n");
const commit = "a".repeat(40),
  prefix = "native-fresh-next-proof/";
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
    const bytes = Buffer.from(
      readFileSync(new URL("../" + path, import.meta.url))
        .toString("utf8")
        .replaceAll("\r\n", "\n"),
    );
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
      env: { VAETTIR_RELEASE_COMMIT: commit, PYTHONDONTWRITEBYTECODE: "1" },
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

const nextPhases = [
  "release-units",
  "assertion-compile-1",
  "assertion-compile-2",
  "assertion-compile-3",
];
function inputFixture() {
  const f = fixture();
  return {
    phase: "release-units",
    core: {
      completed: f.completed,
      expected: f.expected,
      plan: f.plan,
      planningInput: f.input,
    },
    completedPhases: [],
    budget: {
      mode: "bounded-probe",
      compileSeconds: 1980,
      postCompileReserveSeconds: 240,
      totalSeconds: 2520,
    },
  };
}
function phaseFixture(input, plan = planNativeFreshNextPhase(input)) {
  const previous =
    input.completedPhases.at(-1)?.completed ?? input.core.completed;
  const last = JSON.parse(
    Buffer.from(previous.receiptChain.at(-1).base64, "base64"),
  );
  const receipt = {
    ...last,
    phase: input.phase,
    predecessorSha256: previous.receiptSha256,
    state: {
      release: { ...last.state.release, sha256: hash(input.phase) },
      assertions: { ...last.state.assertions },
    },
    proof: {},
  };
  const receiptBytes = encode(receipt),
    receiptSha256 = hash(receiptBytes);
  const phase = {
    schemaVersion: 1,
    purpose: "fresh-native-next-phase-evidence",
    phase: input.phase,
    planSha256: plan.planSha256,
    sourceCommit: plan.identity.sourceCommit,
    sourceSha256: plan.identity.sourceSha256,
    predecessorImageDigest: previous.imageDigest,
    predecessorReceiptSha256: previous.receiptSha256,
    receiptSha256,
    receiptBase64: receiptBytes.toString("base64"),
    inputsSha256: plan.identity.inputsSha256,
    coreReceiptSha256: plan.identity.coreExpected.receiptSha256,
    coreCandidateSha256: plan.identity.coreCandidateSha256,
    coreAbiReceiptSha256: plan.identity.coreAbiReceiptSha256,
    phaseCommandKind: plan.identity.phaseCommandKind,
    releaseTarget: plan.identity.releaseTarget,
    assertionPartition: plan.identity.assertionPartition,
    recipeExitCode: 0,
    ...falseFlags,
  };
  const log = Buffer.from(
    "SYNTHETIC recorded output, not actual LLVM tests\nNATIVE_FRESH_NEXT_PHASE=" +
      JSON.stringify(phase) +
      "\n",
  );
  const labels = {
    "vaettir.source-commit": plan.identity.sourceCommit,
    "vaettir.source-sha256": plan.identity.sourceSha256,
    "vaettir.prepare-plan": plan.identity.preparePlanSha256,
    "vaettir.continuation-plan": plan.planSha256,
    "vaettir.continuation-phase": input.phase,
    "vaettir.runtime-eligible": "false",
    "vaettir.artifact-purpose": "llvm-builder-checkpoint",
  };
  const raw = encode({
      os: "linux",
      architecture: "amd64",
      config: { Labels: labels },
      rootfs: {
        type: "layers",
        diff_ids: ["sha256:" + hash(input.phase + "diff")],
      },
    }),
    imageConfigDigest = "sha256:" + hash(raw);
  const manifest = JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: { digest: imageConfigDigest },
      layers: [{ digest: "sha256:" + hash(input.phase + "layer"), size: 3000 }],
    }),
    imageDigest = "sha256:" + hash(manifest);
  const expected = {
    buildId:
      "vaettir-api-build:" +
      (nextPhases.indexOf(input.phase) + 3).toString().repeat(8) +
      "-1111-2222-3333-444444444444",
    planSha256: plan.planSha256,
    requestSha256: plan.requestSha256,
    buildspecSha256: plan.buildspecSha256,
    imageDigest,
    imageConfigDigest,
    receiptSha256,
    phaseLogSha256: hash(log),
  };
  const proof = {
    ...phase,
    phaseLogSha256: hash(log),
    imageDigest,
    imageConfigDigest,
    imageSizeBytes: 40000,
    actualStateVerified: true,
    prePushInspection: true,
    digestPullEvidence: false,
  };
  const completed = {
    schemaVersion: 1,
    purpose: "completed-fresh-native-next-phase",
    phase: input.phase,
    status: "SUCCEEDED",
    ...expected,
    sourceCommit: plan.identity.sourceCommit,
    sourceSha256: plan.identity.sourceSha256,
    proof,
    receiptChain: [
      ...previous.receiptChain,
      {
        phase: input.phase,
        sha256: receiptSha256,
        base64: phase.receiptBase64,
      },
    ],
    registryManifest: {
      failures: [],
      images: [
        {
          imageId: { imageDigest, imageTag: plan.candidateTag },
          imageManifest: manifest,
        },
      ],
    },
    registryConfigBase64: raw.toString("base64"),
    ...falseFlags,
  };
  return {
    completed,
    expected,
    plan,
    phase,
    receipt,
    receiptBytes,
    log,
    labels,
    raw,
  };
}
function sequence() {
  let input = inputFixture();
  const records = [];
  for (const phase of nextPhases) {
    input = {
      ...input,
      phase,
      completedPhases: records.map(({ completed, expected, plan }) => ({
        completed,
        expected,
        plan,
      })),
    };
    const f = phaseFixture(input);
    records.push({ ...f, input });
  }
  return records;
}
function buildFiles(f) {
  const original = fixture().files,
    files = { ...original };
  for (const entry of f.completed.receiptChain)
    files["/build/llvm-phase-receipts/" + entry.phase + ".json"] = Buffer.from(
      entry.base64,
      "base64",
    );
  return files;
}
function hostFiles(f, ending = "\n") {
  const p = f.plan,
    c = f.completed;
  const state = {
    phase: c.phase,
    planSha256: p.planSha256,
    receiptSha256: c.receiptSha256,
    coreCandidateSha256: p.identity.coreCandidateSha256,
    coreAbiReceiptSha256: p.identity.coreAbiReceiptSha256,
    actualStateVerified: true,
    runtimeAcceptance: false,
  };
  const log = Buffer.from(f.log.toString().replaceAll("\n", ending));
  const proof = { ...c.proof, phaseLogSha256: hash(log) };
  const files = {
    [prefix + "compile.log"]: log,
    [prefix + "phase-receipt.json"]: f.receiptBytes,
    [prefix + "phase-proof.json"]: encode(
      Object.fromEntries(
        Object.entries(proof).filter(
          ([k]) =>
            ![
              "imageDigest",
              "imageConfigDigest",
              "imageSizeBytes",
              "actualStateVerified",
              "prePushInspection",
              "digestPullEvidence",
            ].includes(k),
        ),
      ),
    ),
    [prefix + "candidate-manifest.json"]: encode(c.registryManifest),
    [prefix + "candidate-inspect.json"]: encode([
      {
        Id: c.imageConfigDigest,
        Size: c.proof.imageSizeBytes,
        Os: "linux",
        Architecture: "amd64",
        Config: { Labels: f.labels },
      },
    ]),
    [prefix + "commit-id.txt"]: c.imageConfigDigest + ending,
    [prefix + "push.log"]: "digest: " + c.imageDigest + " size: 42" + ending,
    [prefix + "state.log"]:
      "NATIVE_FRESH_NEXT_STATE=" + JSON.stringify(state) + ending,
  };
  return { files, proof };
}

test("fresh complete release-unit and fixed assertion phases have deterministic sequential request identities", () => {
  const records = sequence();
  for (const f of records) {
    const p = f.plan;
    assert.deepEqual(p, planNativeFreshNextPhase(f.input));
    assert.equal(p.request.autoRetryLimitOverride, 0);
    assert.equal(p.request.timeoutInMinutesOverride, 45);
    assert.equal(p.request.computeTypeOverride, "BUILD_GENERAL1_LARGE");
    assert.equal(p.identity.resources.compilerJobs, 5);
    assert.equal(p.identity.resources.cleanupGraceSeconds, 75);
    assert.equal(p.identity.resources.decoderWatchdogSeconds, 2550);
    assert.ok(Buffer.byteLength(p.request.buildspecOverride) <= 25600);
    for (const k of [
      ...Object.keys(falseFlags),
      "forecastAcceptance",
      "defaultRuntimeGraphChanged",
      "finalSupported",
    ])
      assert.equal(p[k], false);
    assert.equal(p.globalDeadlineMayRefuse, true);
    assert.equal(p.dispatchRequiresRootPreflight, true);
    assert.equal(p.requestSha256, hash(JSON.stringify(p.request)));
    assert.equal(p.buildspecSha256, hash(p.request.buildspecOverride));
    const v = validateNativeFreshNextPhaseCompleted(
      f.completed,
      f.expected,
      p,
      f.input,
    );
    assert.equal(v.phase, f.input.phase);
    assert.equal(v.unitAcceptance, false);
    assert.equal(v.runtimeAcceptance, false);
  }
  assert.equal(
    records[0].plan.identity.phaseCommandKind,
    "COMPLETE_RELEASE_UNITS",
  );
  assert.equal(records[0].plan.identity.releaseTarget, "check-llvm-unit");
  for (let n = 1; n < 4; n++) {
    assert.equal(records[n].plan.identity.assertionPartition, n);
    assert.equal(
      records[n].plan.identity.phaseCommandKind,
      "ASSERTION_OBJECT_PARTITION",
    );
    assert.equal(records[n].plan.identity.releaseTarget, null);
  }
  assert.equal(records[3].plan.identity.successorPhase, "final");
});

test("fixed no-bytecode policy is bound to every plan/request and actual phase process without changing the native recipe", () => {
  for (const f of sequence()) {
    const p = f.plan;
    assert.deepEqual(p.identity.pythonBytecodePolicy, {
      PYTHONDONTWRITEBYTECODE: "1",
    });
    assert.deepEqual(
      p.request.environmentVariablesOverride.filter(
        (v) => v.name === "PYTHONDONTWRITEBYTECODE",
      ),
      [{ name: "PYTHONDONTWRITEBYTECODE", value: "1", type: "PLAINTEXT" }],
    );
    assert.equal(
      p.operation.split("--env PYTHONDONTWRITEBYTECODE=1").length - 1,
      2,
    );
    for (const name of ["start", "admit", "pre"])
      assert.match(
        p.generatedPrograms[name],
        /assert\.equal\(process\.env\.PYTHONDONTWRITEBYTECODE,'1'\)/,
      );
    assert.ok(
      p.operation.includes(
        'test "$PYTHONDONTWRITEBYTECODE" = 1;export PYTHONDONTWRITEBYTECODE',
      ),
    );
    assert.ok(
      p.operation.includes(
        "sh /build/scripts/build-llvm-runtime.sh --phase " +
          f.input.phase +
          " --predecessor-sha256 " +
          p.identity.expectedParent.receiptSha256,
      ),
    );
    assert.deepEqual(
      p.identity.expectedScripts,
      f.input.core.plan.identity.expectedScripts,
    );
    assert.equal(
      p.identity.inputsSha256,
      f.input.core.completed.proof.inputsSha256,
    );
    assert.doesNotMatch(
      p.operation,
      /__pycache__|\.pyc|find .*delete|PYTHONOPTIMIZE|--exclude/,
    );
  }
});

test("missing, empty or overridden policy refuses before host admission/private phase input access", () => {
  const f = sequence()[0];
  for (const value of [undefined, "", "0", "true", " 1 "]) {
    for (const name of ["start", "admit", "pre"])
      assert.throws(() =>
        virtual(
          f.plan.generatedPrograms[name],
          {},
          {
            process: {
              env: {
                VAETTIR_RELEASE_COMMIT: commit,
                ...(value === undefined
                  ? {}
                  : { PYTHONDONTWRITEBYTECODE: value }),
              },
            },
          },
        ).run(),
      );
  }
  for (const alter of [
    (p) => delete p.identity.pythonBytecodePolicy,
    (p) => (p.identity.pythonBytecodePolicy.PYTHONDONTWRITEBYTECODE = "0"),
    (p) =>
      (p.request.environmentVariablesOverride =
        p.request.environmentVariablesOverride.filter(
          (v) => v.name !== "PYTHONDONTWRITEBYTECODE",
        )),
    (p) =>
      p.request.environmentVariablesOverride.push({
        name: "PYTHONDONTWRITEBYTECODE",
        value: "0",
        type: "PLAINTEXT",
      }),
  ]) {
    const plan = structuredClone(f.plan);
    alter(plan);
    assert.throws(() =>
      validateNativeFreshNextPhaseCompleted(
        f.completed,
        f.expected,
        plan,
        f.input,
      ),
    );
  }
});

test("actual synthetic Python imports create caches by default but fixed inherited policy leaves complete source/data/output unchanged", (t) => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const local = resolve(repositoryRoot, ".local");
  mkdirSync(local, { recursive: true });
  assert.equal(realpathSync(local), local);
  const owned = mkdtempSync(resolve(local, "native-bytecode-fixture-"));
  assert.equal(realpathSync(owned), owned);
  const python =
    process.platform === "win32"
      ? resolve(
          process.env.LOCALAPPDATA,
          "Programs/Python/Python312/python.exe",
        )
      : "python3";
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.toUpperCase().startsWith("PYTHON"),
    ),
  );
  const moduleFiles = {
    "__init__.py": "from .payload import run\n",
    "payload.py":
      "import hashlib,json\ndef run():\n    assert __debug__\n    data = [{'index':i,'square':i*i,'label':'synthetic-'+str(i)} for i in range(42)]\n    assert len(data)==42 and data[-1]['square']==1681\n    full=json.dumps(data,sort_keys=True,separators=(',',':')).encode('utf-8')\n    print(json.dumps({'procedure':'synthetic-native-import','data':data,'dataSha256':hashlib.sha256(full).hexdigest()},sort_keys=True,separators=(',',':')))\n",
  };
  const invoke =
    "import synthetic_native_fixture;synthetic_native_fixture.run()";
  // The child inherits the phase environment, as lit launched by Ninja does.
  const parent =
    "import subprocess,sys;subprocess.run([sys.executable,'-S','-c'," +
    JSON.stringify(invoke) +
    "],check=True)";
  function inventory(dir) {
    const records = [];
    function walk(path, relative = "") {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort(
        (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      )) {
        const full = resolve(path, entry.name),
          rel = relative ? relative + "/" + entry.name : entry.name;
        assert.ok(full.startsWith(owned + sep));
        assert.equal(entry.isSymbolicLink(), false);
        if (entry.isDirectory()) {
          records.push([rel, "directory"]);
          walk(full, rel);
        } else {
          assert.equal(entry.isFile(), true);
          const bytes = readFileSync(full);
          records.push([rel, "file", bytes.length, hash(bytes)]);
        }
      }
    }
    walk(dir);
    return { records, sha256: hash(JSON.stringify(records) + "\n") };
  }
  try {
    const version = spawnSync(python, ["--version"], {
      env,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    assert.equal(version.status, 0, version.error?.message ?? version.stderr);
    assert.match(version.stdout.trim(), /^Python 3\./);
    t.diagnostic(
      "Synthetic import interpreter: " +
        version.stdout.trim() +
        "; not native Python 3.13 execution acceptance",
    );
    const results = [];
    for (const mode of ["baseline", "policy", "command-line-B"]) {
      const dir = resolve(owned, mode),
        pkg = resolve(dir, "synthetic_native_fixture");
      mkdirSync(pkg, { recursive: true });
      for (const [name, contents] of Object.entries(moduleFiles))
        writeFileSync(resolve(pkg, name), contents, { flag: "wx" });
      const before = inventory(dir);
      const result = spawnSync(
        python,
        mode === "command-line-B"
          ? ["-S", "-B", "-c", invoke]
          : ["-S", "-c", parent],
        {
          cwd: dir,
          env: {
            ...env,
            ...(mode === "policy" ? { PYTHONDONTWRITEBYTECODE: "1" } : {}),
          },
          encoding: "utf8",
          timeout: 10000,
          maxBuffer: 65536,
          windowsHide: true,
        },
      );
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      assert.equal(result.signal, null);
      assert.equal(result.stderr, "");
      const after = inventory(dir);
      assert.deepEqual(
        after.records.filter((r) => r[1] === "file" && r[0].endsWith(".py")),
        before.records.filter((r) => r[1] === "file"),
      );
      if (mode === "baseline") {
        assert.notEqual(after.sha256, before.sha256);
        assert.equal(
          after.records.filter((r) => r[0].endsWith(".pyc")).length,
          2,
        );
        assert.equal(
          after.records.filter((r) => r[0].endsWith("__pycache__")).length,
          1,
        );
      } else
        assert.deepEqual(
          after,
          before,
          "Entire supported synthetic source tree must remain unchanged, without exclusions or deleting caches",
        );
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.data.length, 42);
      assert.equal(payload.data.at(-1).square, 1681);
      assert.equal(payload.dataSha256, hash(JSON.stringify(payload.data)));
      results.push({ before, result, payload });
    }
    assert.deepEqual(results[0].before, results[1].before);
    assert.deepEqual(results[1].before, results[2].before);
    assert.equal(results[0].result.stdout, results[1].result.stdout);
    assert.equal(results[1].result.stdout, results[2].result.stdout);
  } finally {
    assert.ok(owned.startsWith(local + sep + "native-bytecode-fixture-"));
    assert.equal(realpathSync(owned), owned);
    rmSync(owned, { recursive: true, force: false });
  }
});
test("final, skipped/reordered/replayed phases, fake core and mixed inputs are refused", () => {
  for (const mutate of [
    (x) => (x.phase = "final"),
    (x) => (x.phase = "prepare"),
    (x) => (x.phase = "assertion-compile-1"),
    (x) => (x.core.completed.status = "FAILED"),
    (x) => (x.core.completed.proof.actualStateVerified = false),
    (x) =>
      (x.core.completed.sourceCommit =
        "d3a952c5c3c407cba306f4da3de4a0cac2e0908e"),
    (x) => (x.core.planningInput.preparePlan.operation += "injected"),
    (x) => (x.command = () => {}),
  ]) {
    const input = inputFixture();
    mutate(input);
    assert.throws(() => planNativeFreshNextPhase(input));
  }
  const records = sequence();
  for (const mutate of [
    (x) => x.completedPhases.reverse(),
    (x) =>
      (x.completedPhases[0].completed.receiptChain[0].base64 =
        x.completedPhases[0].completed.proof.receiptBase64),
    (x) => (x.completedPhases[0].plan.operation += "changed"),
    (x) =>
      (x.completedPhases[0].expected.imageDigest = "sha256:" + "0".repeat(64)),
    (x) => (x.completedPhases[0].completed.proof.inputsSha256 = "0".repeat(64)),
    (x) =>
      (x.completedPhases[0].completed.proof.coreCandidateSha256 = "0".repeat(
        64,
      )),
  ]) {
    const input = structuredClone(records[3].input);
    mutate(input);
    assert.throws(() => planNativeFreshNextPhase(input));
  }
});
test("phase budget refuses inherited timing forecasts/oversized resource controls and admits only observed remaining time", () => {
  const input = inputFixture();
  for (const change of [
    (b) => (b.mode = "measured"),
    (b) => (b.compileSeconds = 2101),
    (b) => (b.totalSeconds = 2700),
    (b) => (b.postCompileReserveSeconds = 119),
    (b) => (b.totalSeconds = 2100),
    (b) => (b.cpus = 16),
  ]) {
    const x = structuredClone(input);
    change(x.budget);
    assert.throws(() => planNativeFreshNextPhase(x));
  }
  const p = planNativeFreshNextPhase(input),
    start = virtual(p.generatedPrograms.start);
  start.run();
  const file = start.storage.get(prefix + "admission.json");
  assert.equal(file.at(-1), 10);
  virtual(p.generatedPrograms.admit, {
    [prefix + "admission.json"]: file,
  }).run();
  const delayed = JSON.parse(file);
  delayed.startedNs = (774n * 1000000000n).toString();
  assert.throws(() =>
    virtual(p.generatedPrograms.admit, {
      [prefix + "admission.json"]: encode(delayed),
    }).run(),
  );
  assert.ok(
    p.operation.indexOf("compiler-inspect.json") <
      p.operation.indexOf("Remaining observed deadline"),
  );
  assert.ok(
    p.operation.indexOf("Remaining observed deadline") <
      p.operation.indexOf("1980s docker start"),
  );
});
test("all phase-generated JavaScript and exact outer/inner Bash grammar validate without native execution", () => {
  const binary =
    process.platform === "win32"
      ? "C:/Program Files/Git/bin/bash.exe"
      : "/bin/bash";
  for (const f of sequence()) {
    const p = f.plan;
    assert.equal(Object.keys(p.generatedPrograms).length, 23);
    for (const [name, program] of Object.entries(p.generatedPrograms))
      assert.doesNotThrow(
        () => new Script(program),
        name + "/" + f.input.phase,
      );
    const mark = "bash -eu -o pipefail -c ",
      encoded = p.operation.slice(p.operation.indexOf(mark) + mark.length);
    assert.ok(encoded.startsWith("'") && encoded.endsWith("'"));
    for (const operation of [
      p.operation,
      encoded.slice(1, -1).replaceAll("'\\''", "'"),
    ]) {
      const check = spawnSync(binary, ["-n"], {
        input: operation,
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(check.status, 0, check.stderr);
    }
    assert.equal(unpackFreshPrepareOperation(p.transport), p.operation);
    const v = virtual(p.generatedPrograms.decoder);
    v.run();
    assert.equal(v.calls[0][1][4], p.operation);
    assert.equal(v.calls[0][2].timeout, 2550000);
    const bad = virtual(
      p.generatedPrograms.decoder.replace(
        p.transport.compressedSha256,
        "0".repeat(64),
      ),
    );
    assert.throws(() => bad.run());
    assert.equal(bad.calls.length, 0);
  }
});
test("next operation never reinjects source or invokes full acceptance/runtime/IAM routes", () => {
  for (const f of sequence()) {
    const p = f.plan;
    assert.equal(
      JSON.parse(p.request.buildspecOverride).phases.build.commands.length,
      1,
    );
    assert.doesNotMatch(
      p.operation,
      /describe-images|put-object|put-role-policy|update-project|--profile|:latest|docker build|aws s3api|unzip|--phase final /,
    );
    assert.ok(
      p.operation.includes(
        "sh /build/scripts/build-llvm-runtime.sh --phase " +
          f.input.phase +
          " --predecessor-sha256 " +
          p.identity.expectedParent.receiptSha256,
      ),
    );
    assert.ok(p.operation.includes("--memory 14g --cpus 8"));
    assert.ok(p.operation.includes("--memory 2g --cpus 2"));
    assert.ok(p.operation.includes("--kill-after=75s 2445s"));
  }
});
test("precompile exact ledger/source/script/allocator verification runs for all fresh phases", () => {
  for (const f of sequence()) {
    const files = buildFiles(f);
    delete files["/build/llvm-phase-receipts/" + f.input.phase + ".json"];
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
        (x["/build/llvm-phase-receipts/final.json"] =
          Buffer.from("unsupported")),
      (x) => delete x["/build/llvm-phase-receipts/prepare.json"],
    ]) {
      const bad = { ...files };
      alter(bad);
      assert.throws(() => virtual(f.plan.generatedPrograms.pre, bad).run());
    }
  }
});
test("actual evidence bodies rehash unchanged core and successor begin verifies each actual phase state", async () => {
  for (const f of sequence()) {
    const files = buildFiles(f),
      hashCalls = [],
      beginCalls = [];
    const v = virtual(
      f.plan.generatedPrograms.successorBody +
        ";verifyFreshNextSuccessor(fixtureStore,fixtureHash)",
      files,
      {
        fixtureStore: () => ({ begin: (...args) => beginCalls.push(args) }),
        fixtureHash: (...args) => {
          hashCalls.push(args);
          return { sha256: f.plan.identity.coreCandidateSha256, bytes: 1000 };
        },
      },
    );
    const evidence = await v.run();
    assert.equal(evidence.phase, f.input.phase);
    assert.equal(evidence.recipeExitCode, 0);
    assert.equal(evidence.unitAcceptance, false);
    assert.deepEqual(hashCalls, [["/build", "release-core"]]);
    assert.deepEqual(beginCalls, [
      [f.plan.identity.successorPhase, f.expected.receiptSha256],
    ]);
    assert.equal(
      JSON.parse(v.printed[0].slice("NATIVE_FRESH_NEXT_STATE=".length))
        .coreCandidateSha256,
      f.plan.identity.coreCandidateSha256,
    );
    await assert.rejects(
      virtual(
        f.plan.generatedPrograms.evidenceBody +
          ";verifyFreshNextEvidence(fixtureHash)",
        files,
        { fixtureHash: () => ({ sha256: "0".repeat(64), bytes: 1000 }) },
      ).run(),
    );
    const bad = {
      ...files,
      ["/build/llvm-phase-active.json"]: Buffer.from("active"),
    };
    await assert.rejects(
      virtual(
        f.plan.generatedPrograms.evidenceBody +
          ";verifyFreshNextEvidence(fixtureHash)",
        bad,
        {
          fixtureHash: () => ({ sha256: f.plan.identity.coreCandidateSha256 }),
        },
      ).run(),
    );
  }
});
test("actual LF/CRLF phase collector binds exact observed full log and refuses duplicate/false-exit/unit claims", () => {
  for (const f of sequence())
    for (const ending of ["\n", "\r\n"]) {
      const h = hostFiles(f, ending),
        files = { ...h.files };
      delete files[prefix + "phase-proof.json"];
      const v = virtual(f.plan.generatedPrograms.collect, files);
      v.run();
      const b = v.storage.get(prefix + "phase-proof.json");
      assert.equal(b.at(-1), 10);
      const proof = JSON.parse(b);
      assert.equal(proof.phaseLogSha256, hash(files[prefix + "compile.log"]));
      assert.equal(proof.recipeExitCode, 0);
      assert.throws(() =>
        virtual(f.plan.generatedPrograms.collect, {
          ...files,
          [prefix + "compile.log"]: Buffer.concat([
            files[prefix + "compile.log"],
            files[prefix + "compile.log"],
          ]),
        }).run(),
      );
      for (const [key, value] of [
        ["recipeExitCode", 1],
        ["unitAcceptance", true],
        ["coreCandidateSha256", "0".repeat(64)],
        ["releaseTarget", "partial-unit-target"],
      ]) {
        const wrong = { ...f.phase, [key]: value };
        assert.throws(() =>
          virtual(f.plan.generatedPrograms.collect, {
            ...files,
            [prefix + "compile.log"]: Buffer.from(
              "NATIVE_FRESH_NEXT_PHASE=" + JSON.stringify(wrong) + ending,
            ),
          }).run(),
        );
      }
    }
});
const chunkPrefix = "NATIVE_FRESH_NEXT_LOG_CHUNK=";
function logIdentity(raw, phase = "release-units") {
  return { planSha256: "e".repeat(64), phase, phaseLogSha256: hash(raw) };
}
function mutateChunk(messages, index, mutate) {
  const changed = [...messages],
    item = JSON.parse(changed[index].slice(chunkPrefix.length));
  mutate(item);
  changed[index] = chunkPrefix + JSON.stringify(item);
  return changed;
}
// Allows structurally valid transport of deliberately corrupt compression so
// tests reach the compression/member/CRC guards, not just an earlier hash check.
function compressedChunks(compressed, raw, identity = logIdentity(raw)) {
  const data = compressed.toString("base64"),
    width = 12288,
    count = Math.ceil(data.length / width);
  return Array.from(
    { length: count },
    (_, index) =>
      chunkPrefix +
      JSON.stringify({
        schemaVersion: 1,
        purpose: "public-native-compiler-stream",
        planSha256: identity.planSha256,
        phase: identity.phase,
        encoding: "gzip-base64-sha256-v1",
        index,
        count,
        decodedSha256: identity.phaseLogSha256,
        decodedBytes: raw.length,
        compressedSha256: hash(compressed),
        compressedBytes: compressed.length,
        data: data.slice(index * width, (index + 1) * width),
      }),
  );
}
function canonicalGzip(raw) {
  const compressed = gzipSync(raw, { level: 9 });
  compressed[9] = 255;
  return compressed;
}
test("actual generated compiler-stream transport preserves LF/CRLF original bytes for every phase before VERIFIED", () => {
  for (const f of sequence())
    for (const ending of ["\n", "\r\n"]) {
      const h = hostFiles(f, ending),
        raw = h.files[prefix + "compile.log"],
        identity = {
          planSha256: f.plan.planSha256,
          phase: f.input.phase,
          phaseLogSha256: hash(raw),
        };
      const v = virtual(f.plan.generatedPrograms.logTransport, h.files);
      v.run();
      assert.ok(v.printed.length > 0);
      assert.deepEqual(v.printed, encodeNativeFreshPhaseLog(raw, identity));
      const result = reassembleNativeFreshPhaseLog(v.printed, identity);
      assert.deepEqual(result.bytes, raw);
      assert.equal(result.phaseLogSha256, hash(raw));
      // Unwrap the reviewed outer Bash quoting, not a normalized console log.
      const mark = "bash -eu -o pipefail -c ",
        wrapped = f.plan.operation.slice(
          f.plan.operation.indexOf(mark) + mark.length,
        ),
        inner = wrapped.slice(1, -1).replaceAll("'\\''", "'");
      const positions = ["collect", "logTransport", "readback"].map((name) =>
        inner.indexOf(f.plan.generatedPrograms[name].replaceAll("'", "'\\''")),
      );
      assert.ok(positions.every((at) => at >= 0));
      assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
      for (const [key, value] of [
        ["planSha256", "0".repeat(64)],
        ["phase", "final"],
        ["phaseLogSha256", "0".repeat(64)],
      ]) {
        assert.throws(() =>
          virtual(f.plan.generatedPrograms.logTransport, {
            ...h.files,
            [prefix + "phase-proof.json"]: encode({ ...h.proof, [key]: value }),
          }).run(),
        );
      }
    }
});
test("public compiler-stream framing roundtrips exact opaque bytes and bounded multiple chunks without normalization", () => {
  for (const raw of [
    Buffer.from("public compiler\r\npublic unit\n\0雪\n"),
    randomBytes(70000),
  ]) {
    const identity = logIdentity(raw),
      messages = encodeNativeFreshPhaseLog(raw, identity);
    assert.ok(messages.every((line) => Buffer.byteLength(line) <= 16384));
    const result = reassembleNativeFreshPhaseLog(messages, identity);
    assert.deepEqual(result.bytes, raw);
    assert.equal(result.chunks, messages.length);
    assert.equal(result.phase, identity.phase);
    assert.deepEqual(result.limits, {
      decodedBytes: 16777216,
      compressedBytes: 2097152,
      chunkLineBytes: 16384,
      chunks: 228,
    });
    assert.equal(Object.hasOwn(result, "unitAcceptance"), false);
    assert.equal(Object.hasOwn(result, "runtimeAcceptance"), false);
    if (raw.length === 70000) assert.ok(messages.length > 1);
  }
  assert.throws(() =>
    encodeNativeFreshPhaseLog(Buffer.alloc(0), logIdentity(Buffer.alloc(0))),
  );
  const large = Buffer.alloc(16777217);
  assert.throws(() => encodeNativeFreshPhaseLog(large, logIdentity(large)));
  const incompressible = randomBytes(3 * 1024 ** 2);
  assert.throws(() =>
    encodeNativeFreshPhaseLog(incompressible, logIdentity(incompressible)),
  );
});
test("chunk reassembly refuses missing/reordered/duplicate/extra frames and every mismatched scope/metadata field", () => {
  const raw = randomBytes(40000),
    identity = logIdentity(raw),
    messages = encodeNativeFreshPhaseLog(raw, identity);
  for (const bad of [
    [],
    messages.slice(1),
    [...messages, messages[0]],
    [messages[1], messages[0], ...messages.slice(2)],
    [messages[0], messages[0], ...messages.slice(2)],
    ["timestamp " + messages[0], ...messages.slice(1)],
    [...messages, "extra public text"],
    [messages[0] + "\n", ...messages.slice(1)],
    Array(229).fill(messages[0]),
    [chunkPrefix + "x".repeat(16384), ...messages.slice(1)],
  ])
    assert.throws(() => reassembleNativeFreshPhaseLog(bad, identity));
  for (const [key, value] of [
    ["schemaVersion", 2],
    ["purpose", "credential-stream"],
    ["planSha256", "0".repeat(64)],
    ["phase", "assertion-compile-1"],
    ["encoding", "raw"],
    ["index", 1],
    ["count", 999],
    ["decodedSha256", "0".repeat(64)],
    ["decodedBytes", raw.length - 1],
    ["compressedSha256", "0".repeat(64)],
    ["compressedBytes", 0],
    ["data", "AA=="],
    ["extra", true],
    ["decodedBytes", 16777217],
    ["compressedBytes", 2097153],
    ["decodedBytes", 1.5],
    ["index", "0"],
    ["data", "A".repeat(12292)],
  ])
    assert.throws(
      () =>
        reassembleNativeFreshPhaseLog(
          mutateChunk(messages, 0, (item) => {
            item[key] = value;
          }),
          identity,
        ),
      key,
    );
  const repeatedMetadata = mutateChunk(messages, 1, (item) => {
    item.decodedBytes--;
  });
  assert.throws(() =>
    reassembleNativeFreshPhaseLog(repeatedMetadata, identity),
  );
  const reversed = [...messages].reverse().map((line, index) => {
    const item = JSON.parse(line.slice(chunkPrefix.length));
    item.index = index;
    return chunkPrefix + JSON.stringify(item);
  });
  assert.throws(() => reassembleNativeFreshPhaseLog(reversed, identity));
  for (const scope of [
    { ...identity, planSha256: "0".repeat(64) },
    { ...identity, phase: "final" },
    { ...identity, phaseLogSha256: "0".repeat(64) },
    { ...identity, extra: true },
  ])
    assert.throws(() => reassembleNativeFreshPhaseLog(messages, scope));
});
test("chunk JSON and base64 must be canonical with no duplicate fields, whitespace, padding ambiguity or private extras", () => {
  const raw = Buffer.from("xx"),
    identity = logIdentity(raw),
    messages = encodeNativeFreshPhaseLog(raw, identity);
  const item = JSON.parse(messages[0].slice(chunkPrefix.length));
  for (const text of [
    " " + JSON.stringify(item),
    JSON.stringify(item) + "{}",
    JSON.stringify(item).replace(
      '"schemaVersion":1',
      '"schemaVersion":1,"schemaVersion":1',
    ),
    JSON.stringify(Object.fromEntries(Object.entries(item).reverse())),
  ])
    assert.throws(() =>
      reassembleNativeFreshPhaseLog([chunkPrefix + text], identity),
    );
  assert.ok(item.data.endsWith("=="));
  const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    at = item.data.length - 3,
    alternate = alphabet[alphabet.indexOf(item.data[at]) | 1];
  const noncanonical = item.data.slice(0, at) + alternate + "==";
  assert.deepEqual(
    Buffer.from(noncanonical, "base64"),
    Buffer.from(item.data, "base64"),
  );
  assert.throws(() =>
    reassembleNativeFreshPhaseLog(
      mutateChunk(messages, 0, (chunk) => {
        chunk.data = noncanonical;
      }),
      identity,
    ),
  );
  for (const data of [
    item.data + "=",
    item.data + "\n",
    item.data.replace(/\+/, "-") + " ",
  ])
    assert.throws(() =>
      reassembleNativeFreshPhaseLog(
        mutateChunk(messages, 0, (chunk) => {
          chunk.data = data;
        }),
        identity,
      ),
    );
});
test("gzip payload refuses bombs, trailing data, concatenated members, unsupported headers, CRC/size corruption and changed decoded bytes", () => {
  const raw = Buffer.from("public compiler log\n"),
    identity = logIdentity(raw),
    compressed = canonicalGzip(raw);
  const corruptions = [
    Buffer.concat([
      compressed.subarray(0, -8),
      Buffer.from([0]),
      compressed.subarray(-8),
    ]),
    Buffer.concat([compressed, compressed]),
    Buffer.concat([compressed, Buffer.from([0])]),
    canonicalGzip(Buffer.from("different compiler log\n")),
  ];
  for (const offset of [
    3,
    4,
    8,
    9,
    compressed.length - 8,
    compressed.length - 4,
  ]) {
    const changed = Buffer.from(compressed);
    changed[offset] ^= 1;
    corruptions.push(changed);
  }
  for (const bad of corruptions)
    assert.throws(() =>
      reassembleNativeFreshPhaseLog(
        compressedChunks(bad, raw, identity),
        identity,
      ),
    );
  const huge = canonicalGzip(Buffer.alloc(16777217, 65));
  assert.ok(huge.length < 2097152);
  const advertised = Buffer.alloc(16777216, 65),
    bombIdentity = logIdentity(advertised);
  assert.throws(
    () =>
      reassembleNativeFreshPhaseLog(
        compressedChunks(huge, advertised, bombIdentity),
        bombIdentity,
      ),
    /oversized phase log compression/,
  );
  const largeCompressed = Buffer.alloc(2097153);
  assert.throws(() =>
    reassembleNativeFreshPhaseLog(
      compressedChunks(largeCompressed, raw, identity),
      identity,
    ),
  );
});
test("actual pushed readback binds current config/state/phase log, never fabricates digest-pull acceptance", () => {
  for (const f of sequence())
    for (const ending of ["\n", "\r\n"]) {
      const h = hostFiles(f, ending);
      virtual(f.plan.generatedPrograms.candidateInspect, h.files).run();
      const v = virtual(f.plan.generatedPrograms.readback, h.files);
      v.run();
      const emitted = JSON.parse(
        v.printed[0].slice("NATIVE_FRESH_NEXT_VERIFIED=".length),
      );
      assert.deepEqual(emitted, h.proof);
      assert.equal(emitted.prePushInspection, true);
      assert.equal(emitted.digestPullEvidence, false);
      for (const mutate of [
        (x) => (x[prefix + "compile.log"] = Buffer.from("different")),
        (x) => (x[prefix + "commit-id.txt"] = "sha256:" + "0".repeat(64)),
        (x) => {
          const s = JSON.parse(
            x[prefix + "state.log"].slice("NATIVE_FRESH_NEXT_STATE=".length),
          );
          s.coreCandidateSha256 = "0".repeat(64);
          x[prefix + "state.log"] =
            "NATIVE_FRESH_NEXT_STATE=" + JSON.stringify(s) + ending;
        },
      ]) {
        const bad = { ...h.files };
        mutate(bad);
        assert.throws(() =>
          virtual(f.plan.generatedPrograms.readback, bad).run(),
        );
      }
    }
});
test("parent actual digest/config/labels, owned cleanup and container no-mount/resource gates execute", () => {
  const f = phaseFixture(inputFixture()),
    p = f.plan,
    parent = f.input?.core?.completed ?? inputFixture().core.completed;
  const parentLabels = JSON.parse(
    Buffer.from(parent.registryConfigBase64, "base64"),
  ).config.Labels;
  const files = {
    [prefix + "parent-manifest.json"]: encode(parent.registryManifest),
    [prefix + "parent-inspect.json"]: encode([
      {
        Id: parent.imageConfigDigest,
        Size: 40000,
        Os: "linux",
        Architecture: "amd64",
        RepoDigests: [p.importedImage],
        Config: { Labels: parentLabels },
      },
    ]),
  };
  virtual(p.generatedPrograms.manifest, files).run();
  virtual(p.generatedPrograms.inspect, files).run();
  virtual(p.generatedPrograms.disk).run();
  const bad = JSON.parse(files[prefix + "parent-inspect.json"]);
  bad[0].RepoDigests = [];
  assert.throws(() =>
    virtual(p.generatedPrograms.inspect, {
      ...files,
      [prefix + "parent-inspect.json"]: encode(bad),
    }).run(),
  );
  const id = "8".repeat(64),
    container = {
      Id: id,
      Image: parent.imageConfigDigest,
      Config: {
        Image: p.importedImage,
        Labels: { "vaettir.next-owner": p.planSha256 },
        Env: ["PYTHONDONTWRITEBYTECODE=1"],
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
  const cFiles = {
    [prefix + "container-id"]: id,
    [prefix + "cleanup-image-id"]: container.Image,
    [prefix + "cleanup-inspect.json"]: encode([container]),
    [prefix + "compiler-inspect.json"]: encode([container]),
  };
  virtual(p.generatedPrograms.cleanup, cFiles).run();
  virtual(p.generatedPrograms.compilerInspect, cFiles).run();
  for (const env of [
    undefined,
    [],
    ["PYTHONDONTWRITEBYTECODE=0"],
    ["PYTHONDONTWRITEBYTECODE=1", "PYTHONDONTWRITEBYTECODE=0"],
    ["PYTHONDONTWRITEBYTECODE=1", "PYTHONDONTWRITEBYTECODE=1"],
  ]) {
    const bad = structuredClone(container);
    bad.Config.Env = env;
    assert.throws(() =>
      virtual(p.generatedPrograms.compilerInspect, {
        ...cFiles,
        [prefix + "compiler-inspect.json"]: encode([bad]),
      }).run(),
    );
  }
  const read = virtual(p.generatedPrograms.readId, cFiles);
  read.run();
  assert.equal(read.printed[0], id);
  virtual(p.generatedPrograms.readId).run();
  for (const change of [
    (c) => (c.Id = "0".repeat(64)),
    (c) => (c.Config.Labels["vaettir.next-owner"] = "0".repeat(64)),
    (c) => (c.Image = "sha256:" + "0".repeat(64)),
    (c) => (c.Mounts = [{ Source: "/foreign" }]),
  ]) {
    const bad = structuredClone(container);
    change(bad);
    assert.throws(() =>
      virtual(p.generatedPrograms.cleanup, {
        ...cFiles,
        [prefix + "cleanup-inspect.json"]: encode([bad]),
      }).run(),
    );
  }
});
test("terminal evidence rejects errors, modified ancestry/recipe provenance, unsupported acceptance and raw config mismatch", () => {
  const f = phaseFixture(inputFixture());
  for (const change of [
    (x) => (x.completed.status = "FAILED"),
    (x) => (x.completed.proof.actualStateVerified = false),
    (x) => (x.completed.proof.digestPullEvidence = true),
    (x) => (x.completed.unitAcceptance = true),
    (x) => (x.completed.proof.recipeExitCode = 1),
    (x) => (x.completed.proof.assertionPartition = 1),
    (x) => (x.completed.proof.coreCandidateSha256 = "0".repeat(64)),
    (x) => (x.completed.proof.phaseLogSha256 = "unknown"),
    (x) => (x.completed.proof.phaseLogSha256 = "0".repeat(64)),
    (x) => x.completed.receiptChain.shift(),
    (x) => (x.completed.registryConfigBase64 += "="),
    (x) =>
      (x.expected.receiptSha256 = x.plan.identity.expectedParent.receiptSha256),
    (x) => (x.plan.request.autoRetryLimitOverride = 1),
    (x) => (x.completed.extra = "unsupported"),
  ]) {
    const x = structuredClone(f);
    change(x);
    assert.throws(() =>
      validateNativeFreshNextPhaseCompleted(
        x.completed,
        x.expected,
        x.plan,
        inputFixture(),
      ),
    );
  }
});
test("registry platform or continuation label forgery refused even with new matching external digests", () => {
  for (const change of [
    (c) => (c.os = "windows"),
    (c) => (c.architecture = "arm64"),
    (c) => (c.rootfs.diff_ids = []),
    (c) => (c.config.Labels["vaettir.continuation-phase"] = "final"),
    (c) => (c.config.Labels["vaettir.runtime-eligible"] = "true"),
  ]) {
    const f = phaseFixture(inputFixture()),
      config = JSON.parse(
        Buffer.from(f.completed.registryConfigBase64, "base64"),
      );
    change(config);
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
      validateNativeFreshNextPhaseCompleted(
        f.completed,
        f.expected,
        f.plan,
        inputFixture(),
      ),
    );
  }
});
