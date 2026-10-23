// Synthetic original-origin/flat-lineage fixtures only, never actual LLVM/CI proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { Script } from "node:vm";
import { constants } from "node:fs";
import { gzipSync, gunzipSync as requireGunzip } from "node:zlib";
import { spawnSync } from "node:child_process";
import { historicalNativeV1RecipeFixture } from "./native-v1-recipe-test-fixture.mjs";
import { historicalRuntimeDockerfileFixture } from "./historical-runtime-dockerfile-test-fixture.mjs";
import {
  createNativeFreshFinalCapsule,
  planNativeFreshFinal,
  encodeNativeFreshFinalLog,
  reassembleNativeFreshFinalLog,
} from "./native-builder-fresh-final-plan.mjs";
import {
  planNativeFreshPrepare,
  FRESH_NATIVE_SCRIPT_LF_HASHES,
  unpackFreshPrepareOperation,
} from "./native-builder-fresh-prepare.mjs";
import { planNativeFreshCore } from "./native-builder-fresh-core.mjs";
import { planNativeFreshNextPhase } from "./native-builder-fresh-next-phase.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const encode = (x) => Buffer.from(JSON.stringify(x) + "\n");
const commit = "a".repeat(40);
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
      : name === "Dockerfile.api"
      ? historicalRuntimeDockerfileFixture(Buffer.from(raw.toString("utf8").replaceAll("\r\n", "\n"))).bytes
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

function finalFixture() {
  const records = sequence(),
    c = records[0].input.core;
  const modules = Object.fromEntries(
    [
      "native-builder-fresh-final-verifier.mjs",
      "native-builder-fresh-final-adapter.mjs",
    ].map((n) => {
      const b = readFileSync(new URL(n, import.meta.url));
      return [n, { base64: b.toString("base64"), sha256: hash(b) }];
    }),
  );
  const capsule = createNativeFreshFinalCapsule(modules);
  return {
    core: c,
    completedPhases: records.map(({ completed, expected, plan }) => ({
      completed,
      expected,
      plan,
    })),
    capsule: {
      bytes: capsule.bytes,
      sha256: capsule.sha256,
      s3Key: capsule.s3Key,
    },
    budget: {
      mode: "bounded-probe",
      recipeSeconds: 1200,
      verificationReserveSeconds: 900,
      totalSeconds: 2520,
    },
  };
}
test("complete flat accepted lineage yields deterministic final-only external capsule request within25600B", (t) => {
  const input = finalFixture(),
    p = planNativeFreshFinal(input);
  assert.deepEqual(p, planNativeFreshFinal(input));
  assert.equal(p.identity.receipts.length, 6);
  assert.equal(p.identity.receipts.at(-1).phase, "assertion-compile-3");
  assert.ok(Buffer.byteLength(p.request.buildspecOverride) <= 25600);
  assert.equal(p.request.autoRetryLimitOverride, 0);
  assert.equal(p.request.timeoutInMinutesOverride, 45);
  assert.equal(p.request.computeTypeOverride, "BUILD_GENERAL1_LARGE");
  assert.equal(p.identity.sourceCommit, commit);
  assert.equal(p.identity.sourceWritePolicy.PYTHONDONTWRITEBYTECODE, "1");
  for (const [name, value] of Object.entries(falseFlags))
    assert.equal(p[name], value);
  assert.equal(p.capsuleUploadAuthorized, false);
  assert.equal(p.actualNativeAdapterAccepted, false);
  assert.equal(unpackFreshPrepareOperation(p.transport), p.operation);
  t.diagnostic(
    JSON.stringify({
      capsuleBytes: input.capsule.bytes.length,
      operationBytes: Buffer.byteLength(p.operation),
      compressedOperationBytes: p.transport.compressedBytes,
      buildspecBytes: Buffer.byteLength(p.request.buildspecOverride),
      requestBytes: Buffer.byteLength(JSON.stringify(p.request)),
      generatedPrograms: Object.keys(p.generatedPrograms).length,
    }),
  );
});
test("missing/reordered/failed/self-declared parents and foreign/core inputs never substitute for seven phases", () => {
  const input = finalFixture();
  for (const change of [
    (x) => x.completedPhases.pop(),
    (x) => x.completedPhases.reverse(),
    (x) => (x.completedPhases[0].completed.status = "FAILED"),
    (x) =>
      (x.completedPhases[3].completed.purpose =
        "public-native-source-integrity-diagnostic"),
    (x) => (x.completedPhases[3].expected.receiptSha256 = "f".repeat(64)),
    (x) => (x.core.completed.status = "FAILED"),
    (x) => (x.completedPhases[2].plan.identity.sourceCommit = "f".repeat(40)),
  ]) {
    const x = structuredClone(input);
    change(x);
    x.capsule.bytes = Buffer.from(x.capsule.bytes);
    assert.throws(() => planNativeFreshFinal(x));
  }
});
test("capsule exact frozen verifier/adapter bytes and whole object/path identity refuse tampering/unknown code", () => {
  const input = finalFixture();
  for (const change of [
    (x) => (x.capsule.bytes[0] ^= 1),
    (x) => (x.capsule.sha256 = "1".repeat(64)),
    (x) => (x.capsule.s3Key = "native-helper-capsules/latest.json"),
    (x) => {
      const v = JSON.parse(x.capsule.bytes);
      v.members["evil.mjs"] =
        v.members["native-builder-fresh-final-adapter.mjs"];
      x.capsule.bytes = Buffer.from(JSON.stringify(v));
      x.capsule.sha256 = hash(x.capsule.bytes);
      x.capsule.s3Key = "native-helper-capsules/" + x.capsule.sha256 + ".json";
    },
  ]) {
    const x = structuredClone(input);
    x.capsule.bytes = Buffer.from(x.capsule.bytes);
    change(x);
    assert.throws(() => planNativeFreshFinal(x));
  }
});
test("one global bounded budget cannot be extended/replaced with borrowed timing promises", () => {
  const input = finalFixture();
  for (const change of [
    (x) => (x.budget.totalSeconds = 2700),
    (x) => (x.budget.recipeSeconds = 1801),
    (x) => (x.budget.verificationReserveSeconds = 599),
    (x) => (x.budget.mode = "forecast"),
    (x) => {
      x.budget.recipeSeconds = 1800;
      x.budget.verificationReserveSeconds = 900;
    },
  ]) {
    const x = structuredClone(input);
    x.capsule.bytes = Buffer.from(x.capsule.bytes);
    change(x);
    assert.throws(() => planNativeFreshFinal(x));
  }
});
test("all generated programs and capsule ESM parse without filesystem/native/cloud execution", () => {
  const input = finalFixture(),
    p = planNativeFreshFinal(input);
  for (const source of Object.values(p.generatedPrograms)) new Script(source);
  const capsule = JSON.parse(input.capsule.bytes);
  for (const name of [
    "native-fresh-final-transport.mjs",
    "native-fresh-final-runner.mjs",
  ]) {
    const source = Buffer.from(
      capsule.members[name].base64,
      "base64",
    ).toString();
    const r = spawnSync(process.execPath, ["--input-type=module", "--check"], {
      input: source,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
  }
});
test("operation preserves original sh-x final with full default adapters twice,14GiB8CPU isolation and no source reinjection", () => {
  const p = planNativeFreshFinal(finalFixture());
  const capsule = JSON.parse(finalFixture().capsule.bytes),
    runner = Buffer.from(
      capsule.members["native-fresh-final-runner.mjs"].base64,
      "base64",
    ).toString();
  assert.match(
    runner,
    /sh -x \/build\/scripts\/build-llvm-runtime.sh --phase final/,
  );
  assert.match(runner, /verifyNativeFreshFinalState/);
  assert.match(runner, /createNativeFreshFinalAdapter/);
  assert.match(runner, /cleanupOwnedExtraction/);
  assert.match(runner, /PYTHONDONTWRITEBYTECODE: "1"/);
  assert.equal((p.operation.match(/--memory 14g --cpus 8/g) ?? []).length, 3);
  assert.match(
    p.generatedPrograms.containerGuardImage,
    /PYTHONDONTWRITEBYTECODE=1/,
  );
  assert.match(
    p.generatedPrograms.compare,
    /assert.deepEqual\(pre.review,image.review\)/,
  );
  assert.match(p.generatedPrograms.bootstrapRecipe, /if\('recipe'==='recipe'\)\{assert.equal\(fs.existsSync\(dir\),false/);
  assert.match(p.generatedPrograms.bootstrapPre, /if\('pre'==='recipe'\)/);
  assert.ok(
    p.generatedPrograms.capsuleGate.indexOf("assert.equal(sha(b)") <
      p.generatedPrograms.capsuleGate.indexOf("fs.mkdirSync"),
  );
  assert.doesNotMatch(
    p.operation,
    /docker build|aws s3api put|ecs |rds |migrate|:latest|checkpointStore\(\)\.begin/,
  );
});
function identity(raw) {
  return {
    phase: "final",
    planSha256: "a".repeat(64),
    phaseLogSha256: hash(raw),
  };
}
test("final stream preserves exactLF/CRLF opaque compiler bytes and multi-chunk data", () => {
  for (const raw of [
    Buffer.from("first\nsecond\n"),
    Buffer.from("first\r\nsecond\r\n"),
    randomBytes(80000),
  ]) {
    const pin = identity(raw),
      lines = encodeNativeFreshFinalLog(raw, pin);
    assert.deepEqual(reassembleNativeFreshFinalLog(lines, pin).bytes, raw);
  }
});
test("final-only stream refuses phase relabel/duplicate/reorder/trailing/canonical scope corruption", () => {
  const raw = randomBytes(80000),
    pin = identity(raw),
    lines = encodeNativeFreshFinalLog(raw, pin);
  assert.throws(() =>
    encodeNativeFreshFinalLog(raw, { ...pin, phase: "assertion-compile-3" }),
  );
  assert.throws(() => reassembleNativeFreshFinalLog([...lines].reverse(), pin));
  assert.throws(() => reassembleNativeFreshFinalLog([...lines, lines[0]], pin));
  assert.throws(() => reassembleNativeFreshFinalLog(lines.slice(1), pin));
  assert.throws(() =>
    reassembleNativeFreshFinalLog(lines, {
      ...pin,
      phaseLogSha256: "b".repeat(64),
    }),
  );
  const prefix = "NATIVE_FRESH_FINAL_LOG_CHUNK=";
  for (const [key, value] of [
    ["phase", "release-units"],
    ["index", 1],
    ["decodedBytes", 1],
    ["data", "invalid"],
    ["unknown", 1],
  ]) {
    const x = [...lines],
      v = JSON.parse(x[0].slice(prefix.length));
    v[key] = value;
    x[0] = prefix + JSON.stringify(v);
    assert.throws(() => reassembleNativeFreshFinalLog(x, pin));
  }
  assert.throws(() =>
    reassembleNativeFreshFinalLog([lines[0] + " ", ...lines.slice(1)], pin),
  );
});
test("gzip CRC/ISIZE/additional members are refused even when outer compressed hashes recomputed", () => {
  const raw = Buffer.from("actual opaque bytes\n"),
    pin = identity(raw),
    lines = encodeNativeFreshFinalLog(raw, pin),
    prefix = "NATIVE_FRESH_FINAL_LOG_CHUNK=";
  for (const alter of [
    (b) => {
      b[b.length - 8] ^= 1;
      return b;
    },
    (b) => {
      b[b.length - 4] ^= 1;
      return b;
    },
    (b) => Buffer.concat([b, gzipSync(Buffer.from("extra"))]),
  ]) {
    const v = JSON.parse(lines[0].slice(prefix.length)),
      b = alter(Buffer.from(v.data, "base64"));
    v.data = b.toString("base64");
    v.compressedBytes = b.length;
    v.compressedSha256 = hash(b);
    assert.throws(() =>
      reassembleNativeFreshFinalLog([prefix + JSON.stringify(v)], pin),
    );
  }
});

// The generated programs execute against isolated in-memory native records.
// No Docker, module imports, native files, commands, signed URLs or AWS execute.
function vmFixture(initial = {}) {
  const files = new Map(
    Object.entries(initial).map(([path, value]) => [
      path,
      Buffer.isBuffer(value) ? value : Buffer.from(value),
    ]),
  );
  const descriptors = new Map(),
    writes = [],
    directories = [],
    stdout = [];
  let next = 10;
  const get = (path) => {
    assert.ok(files.has(path), "missing synthetic file " + path);
    return files.get(path);
  };
  const stat = (path) => ({
    isFile: () => true,
    isSymbolicLink: () => false,
    size: get(path).length,
    ino: [...files.keys()].indexOf(path) + 1,
  });
  const fs = {
    constants,
    existsSync: (path) => files.has(path),
    lstatSync: stat,
    openSync: (path) => {
      get(path);
      const fd = next++;
      descriptors.set(fd, path);
      return fd;
    },
    fstatSync: (fd) => stat(descriptors.get(fd)),
    readFileSync: (path) =>
      get(typeof path === "number" ? descriptors.get(path) : path),
    closeSync: (fd) => descriptors.delete(fd),
    mkdirSync: (path, options) => {
      assert.ok(!directories.includes(path));
      directories.push(path);
      assert.equal(options.mode, 0o700);
    },
    writeFileSync: (path, value, options) => {
      assert.equal(options.flag, "wx");
      assert.ok(!files.has(path));
      files.set(path, Buffer.from(value));
      writes.push(path);
    },
  };
  const process = {
    env: {},
    hrtime: { bigint: () => 1000000000n },
    stdout: { write: (value) => stdout.push(value) },
  };
  const sandbox = {
    Buffer,
    TextDecoder,
    URL,
    AbortSignal,
    process,
    console: {
      log: (value) => stdout.push(value),
      error: (value) => stdout.push(value),
    },
    require: (name) => {
      if (name === "node:fs") return fs;
      if (name === "node:assert/strict") return assert;
      if (name === "node:crypto") return { createHash };
      throw new Error("Unexpected synthetic builtin " + name);
    },
  };
  return {
    files,
    fs,
    process,
    sandbox,
    writes,
    directories,
    stdout,
    run: (source) =>
      new Script(source).runInNewContext(sandbox, { timeout: 2000 }),
  };
}
test("generated capsule gate actually hashes whole bytes before any extraction and pins every member", () => {
  const input = finalFixture(),
    p = planNativeFreshFinal(input),
    prefix = "native-fresh-final-proof/";
  const v = vmFixture({ [prefix + "capsule.json"]: input.capsule.bytes });
  v.run(p.generatedPrograms.capsuleGate);
  assert.equal(v.writes.length, 4);
  assert.equal(v.directories.length, 1);
  const capsule = JSON.parse(input.capsule.bytes);
  for (const [n, m] of Object.entries(capsule.members))
    assert.deepEqual(
      v.files.get(prefix + "capsule/" + n),
      Buffer.from(m.base64, "base64"),
    );
  for (const altered of [Buffer.from("{}"), Buffer.from(input.capsule.bytes)]) {
    if (altered.length > 2) altered[altered.length - 2] ^= 1;
    const bad = vmFixture({ [prefix + "capsule.json"]: altered });
    assert.throws(() => bad.run(p.generatedPrograms.capsuleGate));
    assert.equal(bad.writes.length, 0);
    assert.equal(bad.directories.length, 0);
  }
  const duplicate = vmFixture({
    [prefix + "capsule.json"]: input.capsule.bytes,
  });
  duplicate.directories.push(prefix + "capsule");
  assert.throws(() => duplicate.run(p.generatedPrograms.capsuleGate));
  assert.equal(duplicate.writes.length, 0);
});
function containerRecord(p, stage = "pre") {
  return {
    Id: "c".repeat(64),
    Image:
      stage === "pre"
        ? "sha256:" + "a".repeat(64)
        : "sha256:" + "d".repeat(64),
    Config: {
      Labels: { "vaettir.final-owner": p.planSha256 },
      Env: ["OTHER=synthetic", "PYTHONDONTWRITEBYTECODE=1", "VAETTIR_FINAL_CONTROL_SHA=" + "9".repeat(64)],
    },
    HostConfig: {
      NetworkMode: "none",
      Privileged: false,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Memory: 15032385536,
      NanoCpus: 8000000000,
      PidsLimit: 2048,
    },
    Mounts: [],
  };
}
test("executed container and cleanup guards reject wrong owner/resources/bytecode policy/image/mounts", () => {
  const p = planNativeFreshFinal(finalFixture()),
    prefix = "native-fresh-final-proof/";
  for (const stage of ["pre", "image"]) {
    const record = containerRecord(p, stage),
      initial = {
        [prefix + stage + "-cid"]: record.Id,
        [prefix + stage + "-inspect.json"]: JSON.stringify([record]),
        [prefix + "commit-id"]: "sha256:" + "d".repeat(64) + "\n",
        [prefix + "recipe-image-id"]: "sha256:" + "a".repeat(64),
        [prefix + "control-sha"]: "9".repeat(64),
      };
    vmFixture(initial).run(
      p.generatedPrograms[
        stage === "pre" ? "containerGuardPre" : "containerGuardImage"
      ],
    );
    for (const change of [
      (x) => (x.Id = "e".repeat(64)),
      (x) => (x.Image = "sha256:" + "f".repeat(64)),
      (x) => (x.Config.Labels["vaettir.final-owner"] = "f".repeat(64)),
      (x) => (x.HostConfig.Memory = 2147483648),
      (x) => (x.HostConfig.NanoCpus = 2000000000),
      (x) => (x.HostConfig.NetworkMode = "default"),
      (x) => (x.HostConfig.Privileged = true),
      (x) => (x.Mounts = [{ Type: "bind" }]),
      (x) => x.Config.Env.push("PYTHONDONTWRITEBYTECODE=1"),
      (x) => (x.Config.Env = ["PYTHONDONTWRITEBYTECODE=0"]),
    ]) {
      const bad = structuredClone(record);
      change(bad);
      assert.throws(() =>
        vmFixture({
          ...initial,
          [prefix + stage + "-inspect.json"]: JSON.stringify([bad]),
        }).run(
          p.generatedPrograms[
            stage === "pre" ? "containerGuardPre" : "containerGuardImage"
          ],
        ),
      );
    }
  }
  const records = [
      containerRecord(p),
      { ...containerRecord(p, "image"), Id: "b".repeat(64) },
    ],
    ids = records.map((x) => x.Id).join(" ");
  const initial = {
    [prefix + "cleanup-inspect.json"]: JSON.stringify(records),
    [prefix + "commit-id"]: "sha256:" + "d".repeat(64),
    [prefix + "recipe-cid"]: "e".repeat(64),
    [prefix + "pre-cid"]: records[0].Id,
    [prefix + "image-cid"]: records[1].Id,
    [prefix + "recipe-image-id"]: "sha256:" + "a".repeat(64),
  };
  const good = vmFixture(initial);
  good.process.env.VAETTIR_FINAL_CLEANUP_IDS = ids;
  good.run(p.generatedPrograms.cleanup);
  for (const change of [
    (x) => (x[0].Config.Labels["vaettir.final-owner"] = "bad"),
    (x) => (x[0].Mounts = [{}]),
    (x) => (x[1].Id = x[0].Id),
    (x) => (x[0].Image = "sha256:" + "f".repeat(64)),
  ]) {
    const bad = structuredClone(records);
    change(bad);
    const v = vmFixture({
      ...initial,
      [prefix + "cleanup-inspect.json"]: JSON.stringify(bad),
    });
    v.process.env.VAETTIR_FINAL_CLEANUP_IDS = ids;
    assert.throws(() => v.run(p.generatedPrograms.cleanup));
  }
});
test("executed proof comparison cannot replace separate committed-image verification with metadata-only success", () => {
  const p = planNativeFreshFinal(finalFixture()),
    prefix = "native-fresh-final-proof/",
    raw = Buffer.from("synthetic final receipt\n");
  const review = {
    completeInputsAndObjectsRecomputed: true,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
    deploymentAcceptance: false,
    finalReceiptSha256: hash(raw),
    coreCandidateSha256: "a".repeat(64),
  };
  const evidence = (stage) => ({
    stage,
    planSha256: p.planSha256,
    finalReceiptBase64: raw.toString("base64"),
    review,
    provenance: { memoryLimitBytes: 15032385536 },
  });
  const original = evidence("image"),
    initial = {
      [prefix + "pre-review.json"]: JSON.stringify(evidence("pre")),
      [prefix + "image-review.json"]: JSON.stringify(original),
    };
  const good = vmFixture(initial);
  good.run(p.generatedPrograms.compare);
  assert.deepEqual(good.writes, [prefix + "verified.json"]);
  for (const change of [
    (x) => (x.stage = "pre"),
    (x) => (x.planSha256 = "f".repeat(64)),
    (x) => (x.review.completeInputsAndObjectsRecomputed = false),
    (x) => (x.review.runtimeAcceptance = true),
    (x) => (x.review.coreCandidateSha256 = "b".repeat(64)),
    (x) => (x.provenance.memoryLimitBytes = 2147483648),
    (x) => (x.finalReceiptBase64 = Buffer.from("forged").toString("base64")),
  ]) {
    const bad = structuredClone(original);
    change(bad);
    const v = vmFixture({
      ...initial,
      [prefix + "image-review.json"]: JSON.stringify(bad),
    });
    assert.throws(() => v.run(p.generatedPrograms.compare));
    assert.equal(v.writes.length, 0);
  }
});
test("executed monotonic admission cannot silently reset a stage budget and cleanup reads only owned CID files", () => {
  const p = planNativeFreshFinal(finalFixture()),
    prefix = "native-fresh-final-proof/";
  const v = vmFixture({
    [prefix + "clock.json"]: JSON.stringify({ deadlineNs: "2446000000000" }),
  });
  v.run(p.generatedPrograms.admission);
  const expired = vmFixture({
    [prefix + "clock.json"]: JSON.stringify({ deadlineNs: "2000000000" }),
  });
  assert.throws(() => expired.run(p.generatedPrograms.admission));
  const ids = vmFixture({
    [prefix + "pre-cid"]: "c".repeat(64),
    [prefix + "image-cid"]: "b".repeat(64),
  });
  ids.process.env.VAETTIR_FINAL_CLEANUP_DONE = "b".repeat(64);
  ids.run(p.generatedPrograms.readCleanupIds);
  assert.equal(ids.stdout.join(""), "c".repeat(64));
  const unsafe = vmFixture({ [prefix + "pre-cid"]: "../../arbitrary" });
  assert.throws(() => unsafe.run(p.generatedPrograms.readCleanupIds));
});
test("executed registry manifest requires actual push digest and exact committed config rather than tag-only trust", () => {
  const p = planNativeFreshFinal(finalFixture()),
    prefix = "native-fresh-final-proof/",
    config = "sha256:" + "d".repeat(64);
  const m = {
      schemaVersion: 2,
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: { digest: config },
      layers: [{ digest: "sha256:" + "e".repeat(64), size: 123 }],
    },
    manifest = JSON.stringify(m),
    digest = "sha256:" + hash(manifest);
  const record = {
    failures: [],
    images: [
      {
        imageId: {
          imageDigest: digest,
          imageTag: p.candidateImage.split(":").at(-1),
        },
        imageManifest: manifest,
      },
    ],
  };
  const initial = {
    [prefix + "commit-id"]: config + "\n",
    [prefix + "push.log"]: "tag: digest: " + digest + " size:123\n",
    [prefix + "registry.json"]: JSON.stringify(record),
  };
  const v = vmFixture(initial);
  v.run(p.generatedPrograms.registry);
  assert.deepEqual(JSON.parse(v.files.get(prefix + "registry-identity.json")), {
    imageDigest: digest,
    imageConfigDigest: config,
  });
  for (const change of [
    (x) => (x.failures = [{}]),
    (x) => x.images.push(x.images[0]),
    (x) => (x.images[0].imageId.imageDigest = "sha256:" + "f".repeat(64)),
    (x) => (x.images[0].imageId.imageTag = "latest"),
    (x) => {
      const m = JSON.parse(x.images[0].imageManifest);
      m.config.digest = "sha256:" + "f".repeat(64);
      x.images[0].imageManifest = JSON.stringify(m);
      x.images[0].imageId.imageDigest =
        "sha256:" + hash(x.images[0].imageManifest);
    },
  ]) {
    const bad = structuredClone(record);
    change(bad);
    assert.throws(() =>
      vmFixture({
        ...initial,
        [prefix + "registry.json"]: JSON.stringify(bad),
      }).run(p.generatedPrograms.registry),
    );
  }
  for (const log of [
    "no digest\n",
    initial[prefix + "push.log"] + initial[prefix + "push.log"],
    "tag: digest: sha256:" + "f".repeat(64) + "\n",
  ])
    assert.throws(() =>
      vmFixture({ ...initial, [prefix + "push.log"]: log }).run(
        p.generatedPrograms.registry,
      ),
    );
});
test("executed raw config readback uses bounded synthetic fetch, whole digest and native policy/labels; failures redact URL", async () => {
  const p = planNativeFreshFinal(finalFixture()),
    prefix = "native-fresh-final-proof/";
  const config = {
    os: "linux",
    architecture: "amd64",
    config: {
      Labels: {
        "vaettir.source-commit": p.identity.sourceCommit,
        "vaettir.source-sha256": p.identity.sourceSha256,
        "vaettir.continuation-plan": p.planSha256,
        "vaettir.continuation-phase": "final",
        "vaettir.runtime-eligible": "false",
        "vaettir.artifact-purpose": "llvm-builder-checkpoint",
        "vaettir.final-owner": p.planSha256,
      },
      Env: ["PYTHONDONTWRITEBYTECODE=1"],
    },
  };
  async function runConfig(
    c,
    url = "https://synthetic.s3.us-east-2.amazonaws.com/config?token=LOCAL_SENTINEL",
    identityDigest = "sha256:" + hash(Buffer.from(JSON.stringify(c))),
    declared = Buffer.byteLength(JSON.stringify(c)),
  ) {
    const bytes = Buffer.from(JSON.stringify(c)),
      initial = {
        [prefix + "registry-identity.json"]: JSON.stringify({
          imageDigest: "sha256:" + "e".repeat(64),
          imageConfigDigest: identityDigest,
        }),
        [prefix + "download.json"]: JSON.stringify({
          layerDigest: identityDigest,
          downloadUrl: url,
        }),
        [prefix + "verified.json"]: JSON.stringify({
          planSha256: p.planSha256,
        }),
      },
      v = vmFixture(initial);
    let fetched = 0;
    v.sandbox.fetch = async (actual, options) => {
      fetched++;
      assert.equal(actual.href, url);
      assert.equal(options.redirect, "error");
      return {
        status: 200,
        headers: { get: () => String(declared) },
        body: (async function* () {
          yield bytes.subarray(0, 17);
          yield bytes.subarray(17);
        })(),
      };
    };
    await v.run(p.generatedPrograms.configReadback);
    return { ...v, fetched };
  }
  const good = await runConfig(config);
  assert.equal(good.fetched, 1);
  assert.equal(good.process.exitCode, undefined);
  assert.ok(good.files.has(prefix + "registry-config.bin"));
  const frame = JSON.parse(
    good.stdout.at(-1).slice("NATIVE_FRESH_FINAL_VERIFIED=".length),
  );
  assert.equal(frame.actualPrecommitAndCommittedImageVerified, true);
  assert.equal(frame.digestPullEvidence, false);
  for (const [k, val] of Object.entries(falseFlags))
    assert.equal(frame[k], val);
  for (const change of [
    (x) => (x.os = "windows"),
    (x) => (x.architecture = "arm64"),
    (x) => (x.config.Labels["vaettir.runtime-eligible"] = "true"),
    (x) => (x.config.Labels["vaettir.source-commit"] = "f".repeat(40)),
    (x) => x.config.Env.push("PYTHONDONTWRITEBYTECODE=1"),
  ]) {
    const bad = structuredClone(config);
    change(bad);
    const v = await runConfig(bad);
    assert.equal(v.process.exitCode, 1);
    assert.ok(!v.files.has(prefix + "registry-config.bin"));
    assert.doesNotMatch(v.stdout.join(" "), /LOCAL_SENTINEL/);
  }
  for (const url of [
    "http://synthetic.s3.us-east-2.amazonaws.com/config",
    "https://user:LOCAL_SENTINEL@synthetic.s3.us-east-2.amazonaws.com/config",
    "https://private.invalid/config?token=LOCAL_SENTINEL",
    "https://synthetic.s3.us-east-2.amazonaws.com:8443/config",
  ]) {
    const v = await runConfig(config, url);
    assert.equal(v.fetched, 0);
    assert.equal(v.process.exitCode, 1);
    assert.doesNotMatch(v.stdout.join(" "), /LOCAL_SENTINEL/);
  }
  for (const args of [
    [config, undefined, "sha256:" + "f".repeat(64)],
    [config, undefined, undefined, 262145],
    [config, undefined, undefined, 1],
  ]) {
    const v = await runConfig(...args);
    assert.equal(v.process.exitCode, 1);
    assert.ok(!v.files.has(prefix + "registry-config.bin"));
  }
});
test("generated decoder actually decompresses exact operation into mocked fixed Bash invocation, with global watchdog", () => {
  const p = planNativeFreshFinal(finalFixture()),
    v = vmFixture();
  let call;
  const builtin = v.sandbox.require;
  v.sandbox.require = (name) =>
    name === "node:zlib"
      ? { gunzipSync: (...args) => requireGunzip(...args) }
      : name === "node:child_process"
        ? {
            spawnSync: (...args) => {
              call = args;
              return { error: undefined, signal: null, status: 0 };
            },
          }
        : builtin(name);
  v.run(p.generatedPrograms.decoder);
  assert.equal(call[0], "/bin/bash");
  assert.deepEqual(Array.from(call[1]), [
    "-eu",
    "-o",
    "pipefail",
    "-c",
    p.operation,
  ]);
  assert.equal(call[2].timeout, 2550000);
  assert.equal(call[2].killSignal, "SIGTERM");
  const bad = vmFixture();
  bad.sandbox.require = (name) =>
    name === "node:zlib"
      ? { gunzipSync: requireGunzip }
      : name === "node:child_process"
        ? { spawnSync: () => ({ error: undefined, signal: null, status: 1 }) }
        : builtin(name);
  assert.throws(() => bad.run(p.generatedPrograms.decoder));
});
test("all actual generated Bash nesting parses with installed platform Bash without executing commands", () => {
  const p = planNativeFreshFinal(finalFixture()),
    bash =
      process.platform === "win32"
        ? "C:/Program Files/Git/bin/bash.exe"
        : "/bin/bash";
  const match =
    /^timeout --signal=TERM --kill-after=75s 2445s bash -eu -o pipefail -c '(.*)'$/s.exec(
      p.operation,
    );
  assert.ok(match);
  const inner = match[1].replaceAll("'\\''", "'");
  for (const source of [p.operation, inner]) {
    const outcome = spawnSync(bash, ["-n"], {
      input: source,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.status, 0, outcome.stderr);
  }
});
test("generated bounded capsule reader rejects symlinks/oversize/swapped descriptor before materialization", () => {
  const input = finalFixture(),
    p = planNativeFreshFinal(input),
    prefix = "native-fresh-final-proof/";
  for (const modify of [
    (fs) => {
      const old = fs.lstatSync;
      fs.lstatSync = (path) => ({ ...old(path), isSymbolicLink: () => true });
    },
    (fs) => {
      const old = fs.lstatSync;
      fs.lstatSync = (path) => ({ ...old(path), size: 1048577 });
    },
    (fs) => {
      const old = fs.fstatSync;
      fs.fstatSync = (fd) => ({ ...old(fd), ino: 999 });
    },
  ]) {
    const v = vmFixture({ [prefix + "capsule.json"]: input.capsule.bytes });
    modify(v.fs);
    assert.throws(() => v.run(p.generatedPrograms.capsuleGate));
    assert.equal(v.writes.length, 0);
    assert.equal(v.directories.length, 0);
  }
});
