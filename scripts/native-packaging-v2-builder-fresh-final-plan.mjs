// PURE source-only planning. No cloud/FS/process work occurs at import or plan.
// The produced operation is NOT native/runtime/security/deployment acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, inflateRawSync } from "node:zlib";
import { validateNativeFreshCoreCompleted } from "./native-packaging-v2-builder-fresh-core.mjs";
import { validateNativeFreshNextPhaseCompleted } from "./native-packaging-v2-builder-fresh-next-phase.mjs";
import { nativeValidationShell } from "./native-builder-recovery.mjs";
import { unpackFreshPrepareOperation } from "./native-packaging-v2-builder-fresh-prepare.mjs";

const HEX = /^[a-f0-9]{64}$/;
const phases = [
  "release-units",
  "assertion-compile-1",
  "assertion-compile-2",
  "assertion-compile-3",
];
const repository = "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api";
const bucket = "vaettir-build-source-051722405355";
const flags = Object.freeze({
  unitAcceptance: false,
  packageAcceptance: false,
  runtimeAcceptance: false,
  authenticatedAcceptance: false,
  deploymentAcceptance: false,
});
export const FINAL_CAPSULE_PINS = Object.freeze({
  "native-builder-fresh-final-verifier.mjs":
    "3485c951647c08da77994f73389ccc48654e6148dd539d49fca06269e607a2ff",
  "native-builder-fresh-final-adapter.mjs":
    "e668eee94bc13f87affcdf6565a9853f867724772a55bc80e5b9b29cc6476a25",
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (text) => "'" + text.replaceAll("'", "'\\''") + "'";
function keys(value, names) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...names].sort());
}
function base64(value, max) {
  assert.ok(
    typeof value === "string" &&
      value.length <= Math.ceil(max / 3) * 4 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value),
  );
  const bytes = Buffer.from(value, "base64");
  assert.ok(bytes.length > 0 && bytes.length <= max);
  assert.equal(bytes.toString("base64"), value);
  return bytes;
}
function crc32(raw) {
  let crc = 0xffffffff;
  for (const byte of raw) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Final-only opaque compiler stream, never relabeled as an earlier phase. */
export function encodeNativeFreshFinalLog(raw, identity) {
  keys(identity, ["planSha256", "phase", "phaseLogSha256"]);
  assert.equal(identity.phase, "final");
  assert.match(identity.planSha256, HEX);
  assert.match(identity.phaseLogSha256, HEX);
  assert.ok(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 16777216);
  assert.equal(sha(raw), identity.phaseLogSha256);
  const compressed = gzipSync(raw, { level: 9 });
  compressed[9] = 255;
  assert.ok(compressed.length >= 18 && compressed.length <= 2097152);
  const encoded = compressed.toString("base64"),
    count = Math.ceil(encoded.length / 12288);
  assert.ok(count > 0 && count <= 228);
  return Array.from({ length: count }, (_, index) => {
    const item = {
      schemaVersion: 1,
      purpose: "public-native-final-compiler-stream",
      phase: "final",
      planSha256: identity.planSha256,
      encoding: "gzip-base64-sha256-v1",
      index,
      count,
      decodedBytes: raw.length,
      decodedSha256: sha(raw),
      compressedBytes: compressed.length,
      compressedSha256: sha(compressed),
      data: encoded.slice(index * 12288, (index + 1) * 12288),
    };
    const line = "NATIVE_FRESH_FINAL_LOG_CHUNK=" + JSON.stringify(item);
    assert.ok(Buffer.byteLength(line) <= 16384);
    return line;
  });
}
export function reassembleNativeFreshFinalLog(lines, identity) {
  keys(identity, ["planSha256", "phase", "phaseLogSha256"]);
  assert.equal(identity.phase, "final");
  assert.match(identity.planSha256, HEX);
  assert.match(identity.phaseLogSha256, HEX);
  assert.ok(Array.isArray(lines) && lines.length > 0 && lines.length <= 228);
  const parts = [];
  let first;
  for (const [index, line] of lines.entries()) {
    const prefix = "NATIVE_FRESH_FINAL_LOG_CHUNK=";
    assert.ok(
      typeof line === "string" &&
        Buffer.byteLength(line) <= 16384 &&
        line.startsWith(prefix),
    );
    const text = line.slice(prefix.length),
      item = JSON.parse(text);
    const names = [
      "schemaVersion",
      "purpose",
      "phase",
      "planSha256",
      "encoding",
      "index",
      "count",
      "decodedBytes",
      "decodedSha256",
      "compressedBytes",
      "compressedSha256",
      "data",
    ];
    keys(item, names);
    assert.deepEqual(Object.keys(item), names);
    assert.equal(JSON.stringify(item), text);
    assert.equal(item.schemaVersion, 1);
    assert.equal(item.purpose, "public-native-final-compiler-stream");
    assert.equal(item.phase, "final");
    assert.equal(item.planSha256, identity.planSha256);
    assert.equal(item.encoding, "gzip-base64-sha256-v1");
    assert.equal(item.index, index);
    assert.equal(item.count, lines.length);
    assert.equal(item.decodedSha256, identity.phaseLogSha256);
    assert.match(item.compressedSha256, HEX);
    assert.ok(
      Number.isSafeInteger(item.decodedBytes) &&
        item.decodedBytes > 0 &&
        item.decodedBytes <= 16777216,
    );
    assert.ok(
      Number.isSafeInteger(item.compressedBytes) &&
        item.compressedBytes >= 18 &&
        item.compressedBytes <= 2097152,
    );
    first ??= item;
    for (const key of [
      "count",
      "decodedBytes",
      "decodedSha256",
      "compressedBytes",
      "compressedSha256",
    ])
      assert.equal(item[key], first[key]);
    assert.ok(
      typeof item.data === "string" &&
        item.data.length > 0 &&
        item.data.length <= 12288 &&
        item.data.length % 4 === 0 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(item.data),
    );
    if (index < lines.length - 1) {
      assert.equal(item.data.length, 12288);
      assert.ok(!item.data.includes("="));
    }
    parts.push(item.data);
  }
  const encoded = parts.join("");
  assert.equal(lines.length, Math.ceil(encoded.length / 12288));
  const compressed = base64(encoded, 2097152);
  assert.equal(compressed.length, first.compressedBytes);
  assert.equal(sha(compressed), first.compressedSha256);
  assert.equal(
    compressed.subarray(0, 10).toString("hex"),
    "1f8b08000000000002ff",
  );
  const deflate = compressed.subarray(10, -8),
    result = inflateRawSync(deflate, {
      maxOutputLength: first.decodedBytes,
      info: true,
    });
  assert.equal(
    result.engine.bytesWritten,
    deflate.length,
    "No trailing data/additional members",
  );
  assert.equal(result.buffer.length, first.decodedBytes);
  assert.equal(
    compressed.readUInt32LE(compressed.length - 8),
    crc32(result.buffer),
  );
  assert.equal(
    compressed.readUInt32LE(compressed.length - 4),
    result.buffer.length,
  );
  assert.equal(sha(result.buffer), identity.phaseLogSha256);
  return {
    bytes: result.buffer,
    phase: "final",
    planSha256: identity.planSha256,
    phaseLogSha256: identity.phaseLogSha256,
    chunks: lines.length,
    compressedSha256: first.compressedSha256,
  };
}
function transportModule() {
  return `import assert from 'node:assert/strict';import{createHash}from'node:crypto';import{gzipSync,inflateRawSync}from'node:zlib';const HEX=/^[a-f0-9]{64}$/;const sha=b=>createHash('sha256').update(b).digest('hex');\n${[keys, base64, crc32].map((fn) => fn.toString()).join("\n")}\nexport ${encodeNativeFreshFinalLog.toString()}\nexport ${reassembleNativeFreshFinalLog.toString()}\n`;
}

/** Public failure metadata only: fixed stage/code/basename and numeric frames.
 * Never serialize an Error, its message, arbitrary path, stdout or environment.
 * This function is also embedded verbatim in the hash-pinned external runner.
 */
export function nativeFinalPublicFailure(stage, error) {
  const stages = [
    "bootstrap-materialize", "bootstrap-control", "bootstrap-import",
    "bootstrap-runtime", "runtime-preflight", "runtime-recipe",
    "runtime-receipts", "runtime-module-import", "runtime-adapter",
    "runtime-verifier", "runtime-cleanup", "runtime-postverification",
  ];
  const codes = [
    "ERR_ASSERTION", "ENOENT", "EEXIST", "EACCES", "EPERM", "EIO",
    "ETIMEDOUT", "ERR_MODULE_NOT_FOUND", "ERR_INVALID_ARG_TYPE",
    "ERR_OUT_OF_RANGE", "ERR_BUFFER_TOO_LARGE",
  ];
  const approved = [
    "native-fresh-final-runner.mjs",
    "native-builder-fresh-final-adapter.mjs",
    "native-builder-fresh-final-verifier.mjs",
    "native-llvm-checkpoint.mjs",
    "check-llvm-package.mjs",
    "native-build-concurrency.mjs",
  ];
  let errorCode = "UNCLASSIFIED";
  const frames = [];
  try {
    const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
    if (typeof code === "string" && codes.includes(code)) errorCode = code;
    const stack = Object.getOwnPropertyDescriptor(error, "stack")?.value;
    if (typeof stack === "string") {
      for (const line of stack.slice(-8192).split("\n").slice(-16)) {
        if (frames.length === 4) break;
        // Require a frame, never an arbitrary message containing a basename.
        const match = /^\s+at (?:[^\r\n()]{0,160} \()?((?:file:\/\/)?\/(?:tmp\/vaettir-fresh-final-capsule-[a-f0-9]{64}|build\/scripts)\/([a-z0-9.-]+)):(\d{1,7}):(\d{1,7})\)?$/.exec(line);
        if (!match || !approved.includes(match[2])) continue;
        const lineNumber = Number(match[3]), column = Number(match[4]);
        if (lineNumber > 0 && column > 0)
          frames.push({script: match[2], line: lineNumber, column});
      }
    }
  } catch {
    // A malformed/proxied Error cannot make the failure catch succeed.
  }
  return {
    schemaVersion: 1,
    purpose: "bounded-public-native-final-failure-not-acceptance",
    stage: stages.includes(stage) ? stage : "UNCLASSIFIED",
    errorCode,
    frames,
  };
}

// Serialized as trusted capsule source. No caller/package script is evaluated.
// Called only AFTER the entire capsule member set/control has been hash-pinned.
async function runtime(stage, control) {
  let diagnosticStage = "runtime-preflight";
  try {
  const fs = await import("node:fs"),
    { performance } = await import("node:perf_hooks");
  const assert = (await import("node:assert/strict")).default;
  const { createHash } = await import("node:crypto");
  const { spawnSync } = await import("node:child_process");
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  assert.ok(stage === "pre" || stage === "image");
  assert.equal(process.env.PYTHONDONTWRITEBYTECODE, "1");
  const dir = control.externalDirectory;
  assert.equal(dir, "/tmp/vaettir-fresh-final-capsule-" + control.planSha256);
  function read(path, max) {
    const s = fs.lstatSync(path);
    assert.ok(s.isFile() && !s.isSymbolicLink() && s.size > 0 && s.size <= max);
    const fd = fs.openSync(
      path,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const b = fs.readFileSync(fd);
      assert.equal(b.length, s.size);
      assert.equal(fs.fstatSync(fd).ino, s.ino);
      assert.equal(fs.lstatSync(path).ino, s.ino);
      return b;
    } finally {
      fs.closeSync(fd);
    }
  }
  const remaining = () =>
    Number((BigInt(control.deadlineNs) - process.hrtime.bigint()) / 1000000n);
  assert.ok(remaining() > 0 && remaining() <= 2445000);
  const logPath = dir + "/final.log";
  if (stage === "pre") {
    assert.equal(fs.existsSync(logPath), false);
    assert.ok(
      remaining() >=
        control.recipeSeconds * 1000 +
          control.verificationReserveSeconds * 1000,
    );
    // Exact original file, both full original gates, xtrace only for actual
    // command observation. Never alter source9, outcomes or timeout literals.
    // Limit ONLY the tee subprocess, never compiler/object/package output.
    // Bash file blocks are at most1024B: overbound public logging fails closed.
    diagnosticStage = "runtime-recipe";
    const command = `sh -x /build/scripts/build-llvm-runtime.sh --phase final --predecessor-sha256 ${control.parentReceiptSha256} 2>&1 | (ulimit -f 16384; exec tee ${logPath})`;
    const outcome = spawnSync(
      "/bin/bash",
      ["-eu", "-o", "pipefail", "-c", command],
      {
        stdio: "inherit",
        timeout: Math.min(control.recipeSeconds * 1000, remaining()),
        killSignal: "SIGKILL",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.signal, null);
    assert.equal(outcome.status, 0);
  }
  diagnosticStage = "runtime-receipts";
  const rawLog = read(logPath, 16777216),
    finalRaw = read("/build/llvm-phase-receipts/final.json", 32768);
  const final = JSON.parse(finalRaw);
  assert.equal(final.phase, "final");
  assert.equal(final.predecessorSha256, control.parentReceiptSha256);
  assert.equal(final.inputsSha256, control.inputsSha256);
  // Original unit subprocesses have finished. Rehash the entire external
  // closure AGAIN before these delayed imports, not just before recipe start.
  const checkMembers = () => {
    for (const [name, pin] of Object.entries(control.capsuleMembers)) {
      const b = read(dir + "/" + name, 262144);
      assert.equal(b.length, pin.bytes);
      assert.equal(hash(b), pin.sha256);
    }
  };
  checkMembers();
  diagnosticStage = "runtime-module-import";
  const { createNativeFreshFinalAdapter } = await import(
    dir + "/native-builder-fresh-final-adapter.mjs"
  );
  const { verifyNativeFreshFinalState } = await import(
    dir + "/native-builder-fresh-final-verifier.mjs"
  );
  const { encodeNativeFreshFinalLog } = await import(
    dir + "/native-fresh-final-transport.mjs"
  );
  const verificationId = hash(control.planSha256 + ":" + stage);
  const deadlineMs = performance.now() + remaining();
  diagnosticStage = "runtime-adapter";
  const adapter = await createNativeFreshFinalAdapter({
    verificationId,
    scriptPins: control.scriptPins,
    probePins: {
      "llvm-arm-policy": final.proof["llvm-arm-policy"],
      "llvm-cpu-jit": final.proof["llvm-cpu-jit"],
    },
    finalLog: rawLog,
    finalLogSha256: hash(rawLog),
    deadlineMs,
    cleanupDeadlineMs: deadlineMs + 75000,
    memoryLimitBytes: 14 * 1024 ** 3,
    exclusiveWriter: true,
  });
  let review;
  try {
    diagnosticStage = "runtime-verifier";
    review = verifyNativeFreshFinalState(
      {
        sourceCommit: control.sourceCommit,
        sourceSha256: control.sourceSha256,
        verificationId,
        inputs: control.inputs,
        scriptPins: control.scriptPins,
        sourceManifestSha256: control.sourceManifestSha256,
        receipts: [
          ...control.receipts,
          { phase: "final", sha256: hash(finalRaw) },
        ],
        coreCandidateSha256: control.coreCandidateSha256,
        coreAbiReceiptSha256: control.coreAbiReceiptSha256,
        finalLogSha256: hash(rawLog),
      },
      adapter.ops,
    );
  } finally {
    const priorStage = diagnosticStage;
    diagnosticStage = "runtime-cleanup";
    adapter.cleanupOwnedExtraction();
    diagnosticStage = priorStage;
  }
  diagnosticStage = "runtime-postverification";
  checkMembers();
  assert.ok(remaining() > 0);
  const evidence = {
    stage,
    planSha256: control.planSha256,
    finalReceiptBase64: finalRaw.toString("base64"),
    review,
    provenance: adapter.provenance,
  };
  fs.writeFileSync(
    dir + "/" + stage + "-review.json",
    JSON.stringify(evidence) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  if (stage === "pre")
    for (const line of encodeNativeFreshFinalLog(rawLog, {
      planSha256: control.planSha256,
      phase: "final",
      phaseLogSha256: hash(rawLog),
    }))
      console.log(line);
  console.log("NATIVE_FRESH_FINAL_REVIEW=" + JSON.stringify(evidence));
  } catch (error) {
    console.error("NATIVE_FRESH_FINAL_FAILURE=" + JSON.stringify(nativeFinalPublicFailure(diagnosticStage, error)));
    throw error;
  }
}
function runnerModule() {
  return `const nativeFinalPublicFailure=${nativeFinalPublicFailure.toString()};\nexport ${runtime.toString()}\n`;
}

export function createNativeFreshFinalCapsule(modules) {
  keys(modules, Object.keys(FINAL_CAPSULE_PINS));
  const members = {};
  for (const [name, digest] of Object.entries(FINAL_CAPSULE_PINS)) {
    keys(modules[name], ["base64", "sha256"]);
    const bytes = base64(modules[name].base64, 262144);
    assert.equal(modules[name].sha256, digest);
    assert.equal(sha(bytes), digest);
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    members[name] = {
      base64: bytes.toString("base64"),
      sha256: digest,
      bytes: bytes.length,
    };
  }
  for (const [name, text] of [
    ["native-fresh-final-transport.mjs", transportModule()],
    ["native-fresh-final-runner.mjs", runnerModule()],
  ]) {
    const bytes = Buffer.from(text);
    members[name] = {
      base64: bytes.toString("base64"),
      sha256: sha(bytes),
      bytes: bytes.length,
    };
  }
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      purpose: "hash-pinned-native-final-helper-capsule",
      members,
    }),
  );
  assert.ok(bytes.length <= 1048576);
  return {
    bytes,
    sha256: sha(bytes),
    members: Object.fromEntries(
      Object.entries(members).map(([name, item]) => [
        name,
        { sha256: item.sha256, bytes: item.bytes },
      ]),
    ),
    s3Key: "native-helper-capsules/" + sha(bytes) + ".json",
  };
}
function capsuleOf(input) {
  keys(input, ["bytes", "sha256", "s3Key"]);
  assert.match(input.sha256, HEX);
  assert.ok(
    Buffer.isBuffer(input.bytes) &&
      input.bytes.length > 0 &&
      input.bytes.length <= 1048576,
  );
  assert.equal(sha(input.bytes), input.sha256);
  assert.equal(input.s3Key, "native-helper-capsules/" + input.sha256 + ".json");
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(input.bytes),
  );
  keys(value, ["schemaVersion", "purpose", "members"]);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.purpose, "hash-pinned-native-final-helper-capsule");
  keys(value.members, [
    ...Object.keys(FINAL_CAPSULE_PINS),
    "native-fresh-final-transport.mjs",
    "native-fresh-final-runner.mjs",
  ]);
  const original = Object.fromEntries(
    Object.keys(FINAL_CAPSULE_PINS).map((name) => {
      keys(value.members[name], ["base64", "sha256", "bytes"]);
      return [
        name,
        {
          base64: value.members[name].base64,
          sha256: value.members[name].sha256,
        },
      ];
    }),
  );
  const rebuilt = createNativeFreshFinalCapsule(original);
  assert.deepEqual(input.bytes, rebuilt.bytes);
  assert.equal(input.sha256, rebuilt.sha256);
  return rebuilt;
}

/** No self-declared assertion parent: every plan/receipt/image is independently
 * reconstructed by the reviewed original flat-lineage validator. No live
 * evidence is fetched here; root must bind actual successful builds/logs. */
export function planNativeFreshFinal(input) {
  keys(input, ["core", "completedPhases", "capsule", "budget"]);
  keys(input.core, ["completed", "expected", "plan", "planningInput"]);
  assert.ok(
    Array.isArray(input.completedPhases) && input.completedPhases.length === 4,
    "All four accepted unit/assertion parents required",
  );
  assert.ok(Buffer.byteLength(JSON.stringify(input.core)) <= 2 * 1024 ** 2);
  const core = validateNativeFreshCoreCompleted(
    input.core.completed,
    input.core.expected,
    input.core.plan,
    input.core.planningInput,
  );
  let verified;
  for (const [index, record] of input.completedPhases.entries()) {
    keys(record, ["completed", "expected", "plan"]);
    assert.equal(record.plan.identity.phase, phases[index]);
    verified = validateNativeFreshNextPhaseCompleted(
      record.completed,
      record.expected,
      record.plan,
      {
        phase: phases[index],
        core: input.core,
        completedPhases: input.completedPhases.slice(0, index),
        budget: Object.fromEntries(
          [
            "mode",
            "compileSeconds",
            "postCompileReserveSeconds",
            "totalSeconds",
          ].map((name) => [name, record.plan.identity.resources[name]]),
        ),
      },
    );
  }
  const capsule = capsuleOf(input.capsule);
  keys(input.budget, [
    "mode",
    "recipeSeconds",
    "verificationReserveSeconds",
    "totalSeconds",
  ]);
  assert.equal(input.budget.mode, "bounded-probe");
  assert.equal(input.budget.totalSeconds, 2520);
  assert.ok(
    Number.isSafeInteger(input.budget.recipeSeconds) &&
      input.budget.recipeSeconds >= 60 &&
      input.budget.recipeSeconds <= 1800,
  );
  assert.ok(
    Number.isSafeInteger(input.budget.verificationReserveSeconds) &&
      input.budget.verificationReserveSeconds >= 600 &&
      input.budget.verificationReserveSeconds <= 1800,
  );
  assert.ok(
    input.budget.recipeSeconds +
      input.budget.verificationReserveSeconds +
      60 +
      75 <=
      2520,
  );
  const parent = input.completedPhases[3].expected;
  const identity = {
    schemaVersion: 1,
    purpose: "native-packaging-v2-fresh-final-plan-not-runtime",
    plannerSemanticsSha256: sha(
      [
        planNativeFreshFinal,
        createNativeFreshFinalCapsule,
        capsuleOf,
        assemble,
        runtime,
        nativeFinalPublicFailure,
        runnerModule,
        transportModule,
        encodeNativeFreshFinalLog,
        reassembleNativeFreshFinalLog,
        crc32,
        keys,
        base64,
        sha,
        quote,
        nativeValidationShell,
        validateNativeFreshNextPhaseCompleted,
        validateNativeFreshCoreCompleted,
      ]
        .map((fn) => fn.toString())
        .join("\n") +
        JSON.stringify({
          phases,
          flags,
          FINAL_CAPSULE_PINS,
          repository,
          bucket,
        }),
    ),
    sourceCommit: core.sourceCommit,
    sourceSha256: core.sourceSha256,
    inputsSha256: core.inputsSha256,
    inputs: core.receipt.inputs,
    sourceManifestSha256: input.core.plan.identity.sourceManifestSha256,
    scriptPins: input.core.plan.identity.expectedScripts,
    coreCandidateSha256: input.core.completed.proof.candidateSha256,
    coreAbiReceiptSha256: input.core.completed.proof.abiReceiptSha256,
    preparePlanSha256: input.core.plan.identity.preparePlanSha256,
    expectedParent: { ...parent },
    receipts: verified.chain.map(({ phase, sha256 }) => ({ phase, sha256 })),
    capsule: {
      sha256: capsule.sha256,
      bytes: capsule.bytes.length,
      s3Key: capsule.s3Key,
      members: capsule.members,
    },
    resources: {
      ...input.budget,
      operationSeconds: 2445,
      cleanupGraceSeconds: 75,
      decoderWatchdogSeconds: 2550,
      memoryBytes: 14 * 1024 ** 3,
      cpus: 8,
      compilerJobs: 5,
      minimumDiskAvailableBytes: 72 * 1024 ** 3,
      forecastAcceptance: false,
    },
    sourceWritePolicy: {
      PYTHONDONTWRITEBYTECODE: "1",
      inventoryExclusionsChanged: false,
      nativeInputsChanged: false,
    },
  };
  assert.equal(identity.receipts.length, 6);
  assert.equal(identity.receipts.at(-1).phase, "assertion-compile-3");
  return assemble(identity);
}

function assemble(identity) {
  const planSha256 = sha(JSON.stringify(identity));
  const prefix = "native-fresh-final-proof/",
    dir = "/tmp/vaettir-fresh-final-capsule-" + planSha256;
  const image = repository + ":final-" + planSha256.slice(0, 40),
    parent = repository + "@" + identity.expectedParent.imageDigest;
  const common =
    "const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');const sha=b=>createHash('sha256').update(b).digest('hex');const bounded=(p,n)=>{const s=fs.lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=n);const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const b=fs.readFileSync(fd);assert.equal(b.length,s.size);assert.equal(fs.fstatSync(fd).ino,s.ino);return b;}finally{fs.closeSync(fd)}};";
  const start = `${common}assert.equal(process.env.PYTHONDONTWRITEBYTECODE,'1');assert.equal(process.env.VAETTIR_RELEASE_COMMIT,'${identity.sourceCommit}');const t=process.hrtime.bigint();fs.writeFileSync('${prefix}clock.json',JSON.stringify({startNs:t.toString(),deadlineNs:(t+2445000000000n).toString()})+String.fromCharCode(10),{flag:'wx'});`;
  const capsuleGate = `${common}const b=bounded('${prefix}capsule.json',1048576);assert.equal(b.length,${identity.capsule.bytes});assert.equal(sha(b),'${identity.capsule.sha256}');const c=JSON.parse(b);assert.deepEqual(Object.keys(c).sort(),['members','purpose','schemaVersion']);assert.equal(c.schemaVersion,1);assert.equal(c.purpose,'hash-pinned-native-final-helper-capsule');const pins=${JSON.stringify(identity.capsule.members)};assert.deepEqual(Object.keys(c.members).sort(),Object.keys(pins).sort());fs.mkdirSync('${prefix}capsule',{mode:0o700});for(const[n,p]of Object.entries(pins)){const m=c.members[n];assert.deepEqual(Object.keys(m).sort(),['base64','bytes','sha256']);const raw=Buffer.from(m.base64,'base64');assert.equal(raw.toString('base64'),m.base64);assert.equal(raw.length,p.bytes);assert.equal(m.bytes,p.bytes);assert.equal(sha(raw),p.sha256);assert.equal(m.sha256,p.sha256);fs.writeFileSync('${prefix}capsule/'+n,raw,{flag:'wx',mode:0o400});}`;
  const control = {
    planSha256,
    externalDirectory: dir,
    sourceCommit: identity.sourceCommit,
    sourceSha256: identity.sourceSha256,
    inputsSha256: identity.inputsSha256,
    inputs: identity.inputs,
    scriptPins: identity.scriptPins,
    sourceManifestSha256: identity.sourceManifestSha256,
    receipts: identity.receipts,
    parentReceiptSha256: identity.expectedParent.receiptSha256,
    coreCandidateSha256: identity.coreCandidateSha256,
    coreAbiReceiptSha256: identity.coreAbiReceiptSha256,
    recipeSeconds: identity.resources.recipeSeconds,
    verificationReserveSeconds: identity.resources.verificationReserveSeconds,
    capsuleMembers: identity.capsule.members,
  };
  const writeControl = `${common}const clock=JSON.parse(bounded('${prefix}clock.json',512));assert.match(clock.deadlineNs,/^[0-9]{1,30}$/);assert.ok(BigInt(clock.deadlineNs)>process.hrtime.bigint());const c=${JSON.stringify(control)};c.deadlineNs=clock.deadlineNs;const b=Buffer.from(JSON.stringify(c));assert.ok(b.length<=131072);fs.writeFileSync('${prefix}capsule/control.json',b,{flag:'wx',mode:0o400});fs.writeFileSync('${prefix}control-sha',sha(b),{flag:'wx'});const payload=JSON.stringify({capsuleBase64:bounded('${prefix}capsule.json',1048576).toString('base64'),controlBase64:b.toString('base64')});assert.ok(Buffer.byteLength(payload)<=2097152);fs.writeFileSync('${prefix}stdin.json',payload,{flag:'wx',mode:0o600});`;
  const bootstrap = (stage) =>
    `${common}const publicFailure=${nativeFinalPublicFailure.toString()};let failureStage='bootstrap-materialize';async function run(){const dir='${dir}',pins=${JSON.stringify(identity.capsule.members)};assert.equal(process.env.PYTHONDONTWRITEBYTECODE,'1');assert.equal(fs.realpathSync('/tmp'),'/tmp');if('${stage}'==='pre'){assert.equal(fs.existsSync(dir),false);const parts=[],buf=Buffer.alloc(65536);let total=0;for(;;){const n=fs.readSync(0,buf,0,buf.length,null);if(!n)break;total+=n;assert.ok(total<=2097152);parts.push(Buffer.from(buf.subarray(0,n)));}const p=JSON.parse(Buffer.concat(parts).toString());assert.deepEqual(Object.keys(p).sort(),['capsuleBase64','controlBase64']);const raw=Buffer.from(p.capsuleBase64,'base64');assert.equal(raw.toString('base64'),p.capsuleBase64);assert.equal(raw.length,${identity.capsule.bytes});assert.equal(sha(raw),'${identity.capsule.sha256}');const c=JSON.parse(raw);assert.deepEqual(Object.keys(c.members).sort(),Object.keys(pins).sort());const control=Buffer.from(p.controlBase64,'base64');assert.equal(control.toString('base64'),p.controlBase64);assert.ok(control.length<=131072);assert.equal(sha(control),process.env.VAETTIR_FINAL_CONTROL_SHA);fs.mkdirSync(dir,{mode:0o700});for(const[n,h]of Object.entries(pins)){const b=Buffer.from(c.members[n].base64,'base64');assert.equal(b.length,h.bytes);assert.equal(sha(b),h.sha256);fs.writeFileSync(dir+'/'+n,b,{flag:'wx',mode:0o400});}fs.writeFileSync(dir+'/control.json',control,{flag:'wx',mode:0o400});}failureStage='bootstrap-control';assert.equal(fs.realpathSync(dir),dir);assert.ok(fs.lstatSync(dir).isDirectory()&&!fs.lstatSync(dir).isSymbolicLink());for(const[n,p]of Object.entries(pins)){const b=bounded(dir+'/'+n,262144);assert.equal(b.length,p.bytes);assert.equal(sha(b),p.sha256);}const b=bounded(dir+'/control.json',131072);assert.equal(sha(b),process.env.VAETTIR_FINAL_CONTROL_SHA);const c=JSON.parse(b);assert.equal(c.planSha256,'${planSha256}');failureStage='bootstrap-import';const{runtime}=await import(dir+'/native-fresh-final-runner.mjs');failureStage='bootstrap-runtime';await runtime('${stage}',c);}run().catch(error=>{console.error('NATIVE_FRESH_FINAL_FAILURE='+JSON.stringify(publicFailure(failureStage,error)));console.error('Pinned final verification refused');process.exitCode=1});`;
  const containerGuard = (stage) =>
    `${common}const a=JSON.parse(bounded('${prefix}${stage}-inspect.json',2097152));assert.equal(a.length,1);const[i]=a;assert.equal(i.Id,bounded('${prefix}${stage}-cid',64).toString());assert.equal(i.Config.Labels['vaettir.final-owner'],'${planSha256}');assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(i.HostConfig.Privileged,false);assert.deepEqual(i.HostConfig.CapDrop,['ALL']);assert.ok(i.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(i.HostConfig.Memory,15032385536);assert.equal(i.HostConfig.NanoCpus,8000000000);assert.equal(i.HostConfig.PidsLimit,2048);assert.deepEqual(i.Mounts,[]);assert.deepEqual(i.Config.Env.filter(x=>x.startsWith('PYTHONDONTWRITEBYTECODE=')),['PYTHONDONTWRITEBYTECODE=1']);assert.equal(i.Image,${stage === "pre" ? JSON.stringify(identity.expectedParent.imageConfigDigest) : `bounded('${prefix}commit-id',80).toString().trim()`});`;
  const admission = `${common}const clock=JSON.parse(bounded('${prefix}clock.json',512));assert.ok(BigInt(clock.deadlineNs)-process.hrtime.bigint()>=${(identity.resources.recipeSeconds + identity.resources.verificationReserveSeconds) * 1000000000}n,'Global remaining budget cannot admit final');`;
  const imageGuard = `${common}const a=JSON.parse(bounded('${prefix}parent-inspect.json',2097152));assert.equal(a.length,1);const[i]=a;assert.equal(i.Id,'${identity.expectedParent.imageConfigDigest}');assert.equal(i.Os,'linux');assert.equal(i.Architecture,'amd64');assert.ok(i.RepoDigests.includes('${parent}'));assert.ok(i.Size>0&&i.Size<64*1024**3);const l=i.Config.Labels;for(const[k,v]of Object.entries(${JSON.stringify({ "vaettir.source-commit": identity.sourceCommit, "vaettir.source-sha256": identity.sourceSha256, "vaettir.prepare-plan": identity.preparePlanSha256, "vaettir.continuation-plan": identity.expectedParent.planSha256, "vaettir.continuation-phase": "assertion-compile-3", "vaettir.runtime-eligible": "false", "vaettir.artifact-purpose": "llvm-builder-checkpoint" })}))assert.equal(l[k],v);`;
  const compare = `${common}const pre=JSON.parse(bounded('${prefix}pre-review.json',262144)),image=JSON.parse(bounded('${prefix}image-review.json',262144));assert.equal(pre.stage,'pre');assert.equal(image.stage,'image');for(const x of [pre,image]){assert.equal(x.planSha256,'${planSha256}');assert.equal(x.review.completeInputsAndObjectsRecomputed,true);assert.equal(x.review.runtimeAcceptance,false);assert.equal(x.review.authenticatedAcceptance,false);assert.equal(x.review.deploymentAcceptance,false);assert.equal(x.provenance.memoryLimitBytes,15032385536);}assert.deepEqual(pre.review,image.review);assert.equal(pre.finalReceiptBase64,image.finalReceiptBase64);const raw=Buffer.from(pre.finalReceiptBase64,'base64');assert.equal(raw.toString('base64'),pre.finalReceiptBase64);assert.equal(sha(raw),pre.review.finalReceiptSha256);fs.writeFileSync('${prefix}verified.json',JSON.stringify({planSha256:'${planSha256}',pre,image})+String.fromCharCode(10),{flag:'wx'});`;
  const registry = `${common}const r=JSON.parse(bounded('${prefix}registry.json',2097152));assert.deepEqual(r.failures??[],[]);assert.equal(r.images.length,1);const i=r.images[0],digest='sha256:'+sha(i.imageManifest),m=JSON.parse(i.imageManifest);assert.equal(i.imageId.imageDigest,digest);assert.equal(i.imageId.imageTag,'${image.split(":").at(-1)}');assert.equal(m.schemaVersion,2);assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');assert.equal(m.config.digest,bounded('${prefix}commit-id',80).toString().trim());assert.ok(m.layers.length>0&&m.layers.length<=100&&m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<16*1024**3);const pushes=bounded('${prefix}push.log',1048576).toString().split(String.fromCharCode(10)).map(x=>/digest: (sha256:[a-f0-9]{64})(?:\\s|$)/.exec(x)).filter(Boolean);assert.equal(pushes.length,1);assert.equal(pushes[0][1],digest);fs.writeFileSync('${prefix}registry-identity.json',JSON.stringify({imageDigest:digest,imageConfigDigest:m.config.digest}),{flag:'wx'});`;
  const configReadback = `${common}async function readback(){const expected=JSON.parse(bounded('${prefix}registry-identity.json',512)),download=JSON.parse(bounded('${prefix}download.json',8192));assert.equal(download.layerDigest,expected.imageConfigDigest);const url=new URL(download.downloadUrl);assert.equal(url.protocol,'https:');assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.port,'');assert.ok(/(^|\\.)s3([.-]us-east-2)?\\.amazonaws\\.com$/.test(url.hostname));const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);const declared=Number(response.headers.get('content-length'));assert.ok(Number.isSafeInteger(declared)&&declared>0&&declared<=262144);let parts=[],size=0;for await(const part of response.body){size+=part.length;assert.ok(size<=262144);parts.push(part);}const bytes=Buffer.concat(parts);assert.equal(bytes.length,declared);assert.equal('sha256:'+sha(bytes),expected.imageConfigDigest);const c=JSON.parse(bytes);assert.equal(c.os,'linux');assert.equal(c.architecture,'amd64');const l=c.config.Labels;for(const[k,v]of Object.entries(${JSON.stringify({ "vaettir.source-commit": identity.sourceCommit, "vaettir.source-sha256": identity.sourceSha256, "vaettir.continuation-plan": planSha256, "vaettir.continuation-phase": "final", "vaettir.runtime-eligible": "false", "vaettir.artifact-purpose": "llvm-builder-checkpoint", "vaettir.final-owner": planSha256 })}))assert.equal(l[k],v);assert.deepEqual(c.config.Env.filter(x=>x.startsWith('PYTHONDONTWRITEBYTECODE=')),['PYTHONDONTWRITEBYTECODE=1']);fs.writeFileSync('${prefix}registry-config.bin',bytes,{flag:'wx'});const proof=JSON.parse(bounded('${prefix}verified.json',524288));console.log('NATIVE_FRESH_FINAL_VERIFIED='+JSON.stringify({...proof,...expected,registryRawConfigSha256:sha(bytes),actualPrecommitAndCommittedImageVerified:true,digestPullEvidence:false,...${JSON.stringify(flags)}}));}readback().catch(()=>{console.error('Final registry readback refused; signed URL withheld');process.exitCode=1});`;
  const readCleanupIds = `${common}const done=(process.env.VAETTIR_FINAL_CLEANUP_DONE||'').split(' ').filter(Boolean),ids=[];for(const name of ['image','pre']){const path='${prefix}'+name+'-cid';if(fs.existsSync(path)){const id=bounded(path,64).toString();assert.match(id,/^[a-f0-9]{64}$/);if(!done.includes(id))ids.push(id);}}assert.equal(new Set(ids).size,ids.length);process.stdout.write(ids.join(' '));`;
  const cleanup = `${common}const ids=process.env.VAETTIR_FINAL_CLEANUP_IDS.split(' ');assert.ok(ids.length>0&&ids.length<=2&&ids.every(x=>/^[a-f0-9]{64}$/.test(x)));const a=JSON.parse(bounded('${prefix}cleanup-inspect.json',2097152));assert.equal(a.length,ids.length);assert.deepEqual(a.map(x=>x.Id).sort(),[...ids].sort());for(const i of a){assert.equal(i.Config.Labels['vaettir.final-owner'],'${planSha256}');assert.deepEqual(i.Mounts,[]);assert.ok(i.Image==='${identity.expectedParent.imageConfigDigest}'||i.Image===bounded('${prefix}commit-id',80).toString().trim());}`;
  const commands = [
    "trap 'exit 124' TERM",
    'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
    `mkdir ${prefix.slice(0, -1)}`,
    `timeout 20s node -e ${quote(start)}`,
    "native_final_cleanup_done=' '",
    //10+20+10+20<=60s for BOTH containers, inside the shared75s grace.
    `cleanup_native_validation(){ native_final_ids=$(VAETTIR_FINAL_CLEANUP_DONE="$native_final_cleanup_done" timeout 10s node -e ${quote(readCleanupIds)}) || return 70; test -n "$native_final_ids" || return 0; timeout 20s docker inspect $native_final_ids >${prefix}cleanup-inspect.json || return 70; VAETTIR_FINAL_CLEANUP_IDS="$native_final_ids" timeout 10s node -e ${quote(cleanup)} || return 70; timeout 20s docker rm -f $native_final_ids >/dev/null || return 70; native_final_cleanup_done="$native_final_cleanup_done$native_final_ids "; }`,
    `timeout 20s node -e ${quote("const fs=require('node:fs'),assert=require('node:assert/strict');const s=fs.statfsSync('/var/lib/docker',{bigint:true});assert.ok(s.bavail*s.bsize>=77309411328n);")}`,
    `timeout 60s aws s3 cp s3://${bucket}/${identity.capsule.s3Key} ${prefix}capsule.json --region us-east-2 --only-show-errors`,
    `timeout 20s node -e ${quote(capsuleGate)}`,
    `timeout 20s node -e ${quote(writeControl)}`,
    "timeout 60s aws ecr get-login-password --region us-east-2 | timeout 60s docker login --username AWS --password-stdin 051722405355.dkr.ecr.us-east-2.amazonaws.com",
    `timeout --signal=TERM --kill-after=20s 300s docker pull ${parent}`,
    `timeout 20s docker image inspect ${parent} >${prefix}parent-inspect.json`,
    `timeout 20s node -e ${quote(imageGuard)}`,
    `native_final_control=$(timeout 20s node -e ${quote(`${common}process.stdout.write(bounded('${prefix}control-sha',64).toString());`)})`,
    `timeout 30s docker create --interactive --cidfile ${prefix}pre-cid --label vaettir.final-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --env PYTHONDONTWRITEBYTECODE=1 --env VAETTIR_FINAL_CONTROL_SHA="$native_final_control" --entrypoint node ${parent} -e ${quote(bootstrap("pre"))}`,
    `native_final_pre=$(timeout 20s node -e ${quote(`${common}process.stdout.write(bounded('${prefix}pre-cid',64).toString());`)})`,
    `timeout 20s docker inspect "$native_final_pre" >${prefix}pre-inspect.json`,
    `timeout 20s node -e ${quote(containerGuard("pre"))}`,
    `timeout 20s node -e ${quote(admission)}`,
    `docker start --attach --interactive "$native_final_pre" <${prefix}stdin.json`,
    'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_final_pre")" = 0',
    `timeout 20s docker cp "$native_final_pre:${dir}/pre-review.json" ${prefix}pre-review.json`,
    `timeout 60s docker commit --change ${quote("LABEL vaettir.continuation-plan=" + planSha256 + " vaettir.continuation-phase=final")} "$native_final_pre" ${image} >${prefix}commit-id`,
    `timeout 30s docker create --cidfile ${prefix}image-cid --label vaettir.final-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --env PYTHONDONTWRITEBYTECODE=1 --env VAETTIR_FINAL_CONTROL_SHA="$native_final_control" --entrypoint node ${image} -e ${quote(bootstrap("image"))}`,
    `native_final_image=$(timeout 20s node -e ${quote(`${common}process.stdout.write(bounded('${prefix}image-cid',64).toString());`)})`,
    `timeout 20s docker inspect "$native_final_image" >${prefix}image-inspect.json`,
    `timeout 20s node -e ${quote(containerGuard("image"))}`,
    'docker start -a "$native_final_image"',
    'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_final_image")" = 0',
    `timeout 20s docker cp "$native_final_image:${dir}/image-review.json" ${prefix}image-review.json`,
    `timeout 20s node -e ${quote(compare)}`,
    `timeout --signal=TERM --kill-after=20s 180s docker push ${image} >${prefix}push.log`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${image.split(":").at(-1)} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json >${prefix}registry.json`,
    `timeout 20s node -e ${quote(registry)}`,
    `native_final_config=$(timeout 20s node -e ${quote(`${common}const x=JSON.parse(bounded('${prefix}registry-identity.json',512));assert.match(x.imageConfigDigest,/^sha256:[a-f0-9]{64}$/);process.stdout.write(x.imageConfigDigest);`)})`,
    `timeout 30s aws ecr get-download-url-for-layer --repository-name vaettir-api --layer-digest "$native_final_config" --region us-east-2 --output json >${prefix}download.json`,
    `timeout 40s node -e ${quote(configReadback)}`,
    "cleanup_native_validation",
    "native_validation_container=''",
    `echo 'NATIVE_FRESH_FINAL_CLEANED=${planSha256}'`,
  ];
  const operation = `timeout --signal=TERM --kill-after=75s 2445s ${nativeValidationShell(commands)}`;
  assert.doesNotMatch(
    operation,
    /docker build|ecs |rds |migrate|put-role-policy|update-project|:latest|checkpointStore\(\)\.begin/,
  );
  const raw = Buffer.from(operation),
    compressed = gzipSync(raw, { level: 9 });
  assert.ok(raw.length <= 524288 && compressed.length <= 131072);
  const transport = {
    encoding: "gzip-base64-sha256-v1",
    decodedSha256: sha(raw),
    decodedBytes: raw.length,
    compressedSha256: sha(compressed),
    compressedBytes: compressed.length,
    base64: compressed.toString("base64"),
  };
  assert.equal(unpackFreshPrepareOperation(transport), operation);
  const decoder = `const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{gunzipSync}=require('node:zlib'),{spawnSync}=require('node:child_process');const p=${JSON.stringify(transport)},sha=b=>createHash('sha256').update(b).digest('hex');const c=Buffer.from(p.base64,'base64');assert.equal(c.toString('base64'),p.base64);assert.equal(c.length,p.compressedBytes);assert.equal(sha(c),p.compressedSha256);const b=gunzipSync(c,{maxOutputLength:524288});assert.equal(b.length,p.decodedBytes);assert.equal(sha(b),p.decodedSha256);const operation=new TextDecoder('utf-8',{fatal:true}).decode(b);const r=spawnSync('/bin/bash',['-eu','-o','pipefail','-c',operation],{stdio:'inherit',timeout:2550000,killSignal:'SIGTERM'});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0);`;
  const buildspec = JSON.stringify({
    version: "0.2",
    phases: {
      build: { commands: ["node -e " + quote(decoder)] },
      post_build: {
        commands: [
          'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
          'echo "FINAL BUILDER VERIFICATION ONLY; NO RUNTIME/DEPLOYMENT ACCEPTANCE"',
        ],
      },
    },
  });
  assert.ok(
    Buffer.byteLength(buildspec) <= 25600,
    "Whole inline buildspec exceeds25600 bytes; no validator removal allowed",
  );
  const request = {
    projectName: "vaettir-api-build",
    sourceTypeOverride: "S3",
    sourceLocationOverride: `${bucket}/releases/${identity.sourceCommit}/source.zip`,
    buildspecOverride: buildspec,
    timeoutInMinutesOverride: 45,
    computeTypeOverride: "BUILD_GENERAL1_LARGE",
    environmentVariablesOverride: [
      {
        name: "VAETTIR_RELEASE_COMMIT",
        value: identity.sourceCommit,
        type: "PLAINTEXT",
      },
      { name: "PYTHONDONTWRITEBYTECODE", value: "1", type: "PLAINTEXT" },
    ],
    idempotencyToken: "native-final-" + planSha256.slice(0, 40),
    autoRetryLimitOverride: 0,
  };
  return {
    identity,
    planSha256,
    request,
    requestSha256: sha(JSON.stringify(request)),
    buildspecSha256: sha(buildspec),
    operation,
    transport,
    capsuleUploadRequired: true,
    capsuleUploadAuthorized: false,
    externalDirectory: dir,
    candidateImage: image,
    importedImage: parent,
    generatedPrograms: {
      start,
      capsuleGate,
      writeControl,
      bootstrapPre: bootstrap("pre"),
      bootstrapImage: bootstrap("image"),
      containerGuardPre: containerGuard("pre"),
      containerGuardImage: containerGuard("image"),
      admission,
      imageGuard,
      compare,
      registry,
      configReadback,
      readCleanupIds,
      cleanup,
      decoder,
    },
    ...flags,
    actualNativeAdapterAccepted: false,
    dispatchRequiresRootPreflight: true,
    globalDeadlineMayRefuse: true,
    defaultRuntimeGraphChanged: false,
  };
}
