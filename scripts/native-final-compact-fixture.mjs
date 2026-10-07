// SYNTHETIC current-V2 lineage and compact metadata ONLY. No native/cloud proof.
// Mechanical fixture adaptation selects corrected recipe BEFORE ZIP creation.
// Reads public source only when explicitly called, never at module import.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createNativeFreshFinalCapsule,
  planNativeFreshFinal,
  planNativeFreshCompactFinal,
  encodeNativeFreshFinalLog,
} from "./native-packaging-v2-builder-fresh-final-plan.mjs";
import { readFinalUnitStreams } from "./native-builder-fresh-final-verifier.mjs";
import {
  planNativeFreshPrepare,
  FRESH_NATIVE_SCRIPT_LF_HASHES,
} from "./native-packaging-v2-builder-fresh-prepare.mjs";
import { planNativeFreshCore } from "./native-packaging-v2-builder-fresh-core.mjs";
import { planNativeFreshNextPhase } from "./native-packaging-v2-builder-fresh-next-phase.mjs";
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
function zip(entries, archiveCommit = commit) {
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
    comment = Buffer.from(archiveCommit);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...local, directory, end, comment]);
}
export function runtimeApplicationFixture(applicationCommit = commit) {
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
    // Current corrected V2 SYNTHETIC bytes, never a canonical Git export.
    const bytes = name === "build-llvm-runtime.sh"
      ? raw
      : Buffer.from(raw.toString("utf8").replaceAll("\r\n", "\n"));
    gitBlobs[name] = bytes;
    gitModes[name] = "100644";
    gitExports[name] =
      name === "Dockerfile.api"
        ? bytes
        : zip({ [path]: bytes }, applicationCommit);
    entries[path] = bytes;
  }
  const archive = zip(entries, applicationCommit);
  return {
    sourceCommit: applicationCommit,
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
  };
}
function fixture() {
  const applicationInput = runtimeApplicationFixture();
  const { gitBlobs } = applicationInput;
  const preparePlan = planNativeFreshPrepare(applicationInput);
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

export function finalFixture() {
  const records = sequence(),
    c = records[0].input.core;
  const modules = Object.fromEntries(
    [
      "native-builder-fresh-final-verifier.mjs",
      "native-builder-fresh-final-adapter.mjs",
    ].map((n) => {
      const b = readFileSync(new URL("./" + n, import.meta.url));
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
export function runtimeCompletedFixture() {
  const input = finalFixture(),
    plan = planNativeFreshFinal(input);
  const log = Buffer.from(
    "SYNTHETIC TEST STREAM, NOT NATIVE ACCEPTANCE\n+ timeout 1800 cmake --build /build/llvm-build --parallel 5 --target check-llvm-unit\nTotal Discovered Tests: 13\n  Passed: 12\n  Skipped: 1\n+ timeout 7200 cmake --build /build/llvm-assert-build --parallel 5 --target check-llvm-unit\nTotal Discovered Tests: 14\n  Passed: 12\n  Unsupported: 2\n",
  );
  const last = input.completedPhases.at(-1).completed.receiptChain.at(-1);
  const prior = JSON.parse(Buffer.from(last.base64, "base64"));
  const artifactBytes = Object.fromEntries(
    [
      "abiReceiptSha256",
      "packageSha256",
      "unitReceiptSha256",
      "llvm-abi.json",
      "llvm-cpu-jit",
      "llvm-arm-policy",
      "llvm-release-configuration.json",
      "llvm-assertions-configuration.json",
    ].map((n) => [n, Buffer.from("SYNTHETIC:" + n)]),
  );
  const receipt = {
    ...prior,
    phase: "final",
    predecessorSha256: last.sha256,
    proof: Object.fromEntries(
      [
        "abiReceiptSha256",
        "packageSha256",
        "unitReceiptSha256",
        "llvm-abi.json",
        "llvm-cpu-jit",
        "llvm-arm-policy",
        "llvm-release-configuration.json",
        "llvm-assertions-configuration.json",
      ].map((name) => [name, hash(artifactBytes[name])]),
    ),
    unitAcceptance: true,
    packageAcceptance: true,
  };
  const raw = Buffer.from(JSON.stringify(receipt) + "\n");
  const chain = [
    ...plan.identity.receipts,
    { phase: "final", sha256: hash(raw) },
  ];
  const review = {
    schemaVersion: 1,
    purpose: "fresh-native-final-state-verification-not-runtime",
    sourceCommit: plan.identity.sourceCommit,
    sourceSha256: plan.identity.sourceSha256,
    inputsSha256: plan.identity.inputsSha256,
    finalReceiptSha256: hash(raw),
    receiptChain: chain,
    state: receipt.state,
    finalLogSha256: hash(log),
    units: readFinalUnitStreams(log),
    coreCandidateSha256: plan.identity.coreCandidateSha256,
    strippedCandidateSha256: hash("SYNTHETIC STRIPPED LIBRARY"),
    packageSha256: receipt.proof.packageSha256,
    packageEntries: 20,
    armVectors: 33,
    fixedCandidateJitResult: 11,
    completeInputsAndObjectsRecomputed: true,
    operationsRequireVerifiedTransport: true,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
    deploymentAcceptance: false,
  };
  const stage = (name) => ({
    stage: name,
    planSha256: plan.planSha256,
    finalReceiptBase64: raw.toString("base64"),
    review: structuredClone(review),
    provenance: {
      verificationId: hash(plan.planSha256 + ":" + name),
      checkpointModuleSha256:
        plan.identity.scriptPins["native-llvm-checkpoint.mjs"],
      abiModuleSha256: plan.identity.scriptPins["check-llvm-package.mjs"],
      finalLogSha256: hash(log),
      exclusiveWriterRequired: true,
      outerWatchdogRequired: true,
      memoryLimitBytes: 14 * 1024 ** 3,
      zstandardSupported: false,
      runtimeAcceptance: false,
      authenticatedAcceptance: false,
      deploymentAcceptance: false,
    },
  });
  const config = Buffer.from(
    JSON.stringify({
      os: "linux",
      architecture: "amd64",
      config: {
        Labels: {
          "vaettir.source-commit": plan.identity.sourceCommit,
          "vaettir.source-sha256": plan.identity.sourceSha256,
          "vaettir.prepare-plan": plan.identity.preparePlanSha256,
          "vaettir.continuation-plan": plan.planSha256,
          "vaettir.continuation-phase": "final",
          "vaettir.runtime-eligible": "false",
          "vaettir.artifact-purpose": "llvm-builder-checkpoint",
          "vaettir.final-owner": plan.planSha256,
        },
        Env: ["PYTHONDONTWRITEBYTECODE=1"],
      },
    }),
  );
  const manifest = JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    config: { digest: "sha256:" + hash(config) },
    layers: [{ digest: "sha256:" + hash("SYNTHETIC LAYER"), size: 1024 }],
  });
  const expected = {
    buildId: "vaettir-api-build:88888888-1111-2222-3333-444444444444",
    planSha256: plan.planSha256,
    requestSha256: plan.requestSha256,
    buildspecSha256: plan.buildspecSha256,
    imageDigest: "sha256:" + hash(manifest),
    imageConfigDigest: "sha256:" + hash(config),
    receiptSha256: hash(raw),
    phaseLogSha256: hash(log),
  };
  const completed = {
    schemaVersion: 1,
    purpose: "completed-fresh-native-final",
    status: "SUCCEEDED",
    ...expected,
    sourceCommit: plan.identity.sourceCommit,
    sourceSha256: plan.identity.sourceSha256,
    capsuleSha256: plan.identity.capsule.sha256,
    verified: {
      planSha256: plan.planSha256,
      pre: stage("pre"),
      image: stage("image"),
      imageDigest: expected.imageDigest,
      imageConfigDigest: expected.imageConfigDigest,
      registryRawConfigSha256: hash(config),
      actualPrecommitAndCommittedImageVerified: true,
      digestPullEvidence: false,
      ...falseFlags,
    },
    receiptChain: [
      ...input.completedPhases.at(-1).completed.receiptChain,
      { phase: "final", sha256: hash(raw), base64: raw.toString("base64") },
    ],
    registryManifest: {
      failures: [],
      images: [
        {
          imageId: {
            imageDigest: expected.imageDigest,
            imageTag: plan.candidateImage.split(":").at(-1),
          },
          imageManifest: manifest,
        },
      ],
    },
    registryConfigBase64: config.toString("base64"),
    ...falseFlags,
  };
  const transport = {
    phaseLogBytes: log,
    phaseLogChunks: encodeNativeFreshFinalLog(log, {
      phase: "final",
      planSha256: plan.planSha256,
      phaseLogSha256: hash(log),
    }),
  };
  return { completed, expected, plan, input, transport, artifactBytes };
}

// Reuses genuine current V2 recursive planning; no relabeled V1 parents or
// replacement planner. All output remains synthetic metadata, not acceptance.
export function fullCompletedFixture() { return runtimeCompletedFixture(); }
export function compactCompletedFixture() {
  const base = runtimeCompletedFixture();
  const plan = planNativeFreshCompactFinal(base.input);
  const names = ["packageSha256","llvm-cpu-jit","llvm-arm-policy","abiReceiptSha256",
    "llvm-abi.json","unitReceiptSha256","llvm-release-configuration.json",
    "llvm-assertions-configuration.json"];
  const paths = [
    "/build/libllvm19_19.1.7-3+vaettir1_amd64.deb",
    "/build/llvm-cpu-jit","/build/llvm-arm-policy","/build/llvm-stripped-abi.json",
    "/build/llvm-abi.json","/build/llvm-final-unit-gates.json",
    "/build/llvm-release-configuration.json","/build/llvm-assertions-configuration.json",
    ...["prepare","release-core","release-units","assertion-compile-1",
      "assertion-compile-2","assertion-compile-3","final"]
      .map(phase => "/build/llvm-phase-receipts/" + phase + ".json"),
  ];
  const files = Object.fromEntries(paths.map((path,index) => [path,index < 8 ?
    base.artifactBytes[names[index]] : Buffer.from(base.completed.receiptChain[index - 8].base64,"base64")]));
  const artifacts = paths.map((path,index) => ({path,sha256:hash(files[path]),
    bytes:files[path].length,mode:index === 1 || index === 2 ? 493 : index >= 8 ? 384 : 420}));
  const compactArtifacts = {inventory:artifacts,inventorySha256:hash(JSON.stringify(artifacts))};
  const fullConfig = JSON.parse(Buffer.from(base.completed.registryConfigBase64,"base64"));
  fullConfig.config.Labels["vaettir.continuation-plan"] = plan.planSha256;
  fullConfig.config.Labels["vaettir.final-owner"] = plan.planSha256;
  const fullLocalConfigBytes = encode(fullConfig);
  const fullLocalImageConfigDigest = "sha256:" + hash(fullLocalConfigBytes);
  const configRaw = encode({
    os:"linux",architecture:"amd64",
    config:{Env:null,Entrypoint:null,Cmd:null,Volumes:null,ExposedPorts:null,
      User:"",WorkingDir:"",Labels:{
        "vaettir.source-commit":plan.identity.sourceCommit,
        "vaettir.source-sha256":plan.identity.sourceSha256,
        "vaettir.prepare-plan":plan.identity.preparePlanSha256,
        "vaettir.continuation-plan":plan.planSha256,
        "vaettir.continuation-phase":"final-compact",
        "vaettir.runtime-eligible":"false",
        "vaettir.artifact-purpose":"llvm-final-artifact-donor",
        "vaettir.final-owner":plan.planSha256,
        "vaettir.transport-kind":"compact-fixed15-v1",
        "vaettir.full-local-image-config":fullLocalImageConfigDigest,
        "vaettir.artifact-inventory-sha256":compactArtifacts.inventorySha256,
        "vaettir.final-receipt-sha256":base.expected.receiptSha256,
      }},
    rootfs:{type:"layers",diff_ids:["sha256:" + hash("SYNTHETIC compact raw layer")]},
  });
  const manifestRaw = JSON.stringify({
    schemaVersion:2,mediaType:"application/vnd.docker.distribution.manifest.v2+json",
    config:{mediaType:"application/vnd.docker.container.image.v1+json",
      size:configRaw.length,digest:"sha256:" + hash(configRaw)},
    layers:[{mediaType:"application/vnd.docker.image.rootfs.diff.tar.gzip",
      size:1024,digest:"sha256:" + hash("SYNTHETIC compact compressed layer")}],
  });
  const expected = {...base.expected,planSha256:plan.planSha256,
    requestSha256:plan.requestSha256,buildspecSha256:plan.buildspecSha256,
    imageDigest:"sha256:" + hash(manifestRaw),imageConfigDigest:"sha256:" + hash(configRaw),
    transportKind:"compact-fixed15-v1",fullLocalImageConfigDigest};
  const stage = name => {
    const value = structuredClone(base.completed.verified[name]);
    value.planSha256 = plan.planSha256;
    value.provenance.verificationId = hash(plan.planSha256 + ":" + name);
    return value;
  };
  const verified = {
    schemaVersion:2,purpose:"verified-fresh-native-compact-final",
    planSha256:plan.planSha256,pre:stage("pre"),image:stage("image"),
    imageDigest:expected.imageDigest,imageConfigDigest:expected.imageConfigDigest,
    registryRawConfigSha256:hash(configRaw),actualPrecommitAndCommittedImageVerified:true,
    digestPullEvidence:false,transportKind:"compact-fixed15-v1",fullLocalImageConfigDigest,
    compactArtifacts,committedCompactFilesVerified:true,compactRootFsLayers:1,...falseFlags,
  };
  const completed = {...base.completed,...expected,schemaVersion:2,
    purpose:"completed-fresh-native-compact-final",verified,compactArtifacts,
    registryConfigBase64:configRaw.toString("base64"),
    registryManifest:{images:[{imageId:{imageDigest:expected.imageDigest,
      imageTag:plan.candidateImage.split(":").at(-1)},imageManifest:manifestRaw}],failures:[]},
  };
  const transport = {phaseLogBytes:base.transport.phaseLogBytes,
    phaseLogChunks:encodeNativeFreshFinalLog(base.transport.phaseLogBytes,
      {phase:"final",planSha256:plan.planSha256,phaseLogSha256:expected.phaseLogSha256}),
    cleanupMarker:"NATIVE_FRESH_COMPACT_FINAL_CLEANED=" + plan.planSha256};
  return {completed,expected,plan,input:base.input,transport,
    artifactBytes:base.artifactBytes,artifacts,files,fullLocalConfigBytes};
}
