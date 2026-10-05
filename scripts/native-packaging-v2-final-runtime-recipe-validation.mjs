// PURE full-final evidence consistency, extracted byte-for-byte in behavior. No import-time I/O, cloud, Docker, credentials or subprocess.
// Caller must hash-pin this module AND the complete static dependency closure
// before import. It validates exact collected evidence; never runs native gates.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  planNativeFreshFinal,
  reassembleNativeFreshFinalLog,
} from "./native-packaging-v2-builder-fresh-final-plan.mjs";
import {
  parseFinalJson,
  readFinalUnitStreams,
} from "./native-builder-fresh-final-verifier.mjs";

const hex = /^[a-f0-9]{64}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const outerFalse = {
  unitAcceptance: false,
  packageAcceptance: false,
  runtimeAcceptance: false,
  authenticatedAcceptance: false,
  deploymentAcceptance: false,
};
function exact(value, names) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...names].sort());
}
function base64(text, max) {
  assert.ok(
    typeof text === "string" &&
      text.length > 0 &&
      text.length <= Math.ceil(max / 3) * 4,
  );
  const raw = Buffer.from(text, "base64");
  assert.ok(raw.length > 0 && raw.length <= max);
  assert.equal(raw.toString("base64"), text);
  return raw;
}
function inventory(value) {
  exact(value, ["sha256", "entries", "bytes"]);
  assert.match(value.sha256, hex);
  assert.ok(
    Number.isSafeInteger(value.entries) &&
      value.entries > 0 &&
      value.entries <= 400000,
  );
  assert.ok(
    Number.isSafeInteger(value.bytes) &&
      value.bytes > 0 &&
      value.bytes <= 64 * 1024 ** 3,
  );
}
function stage(value, stageName, plan, expected, receiptRaw, units) {
  exact(value, [
    "stage",
    "planSha256",
    "finalReceiptBase64",
    "review",
    "provenance",
  ]);
  assert.equal(value.stage, stageName);
  assert.equal(value.planSha256, expected.planSha256);
  assert.deepEqual(base64(value.finalReceiptBase64, 32768), receiptRaw);
  const r = value.review;
  exact(r, [
    "schemaVersion",
    "purpose",
    "sourceCommit",
    "sourceSha256",
    "inputsSha256",
    "finalReceiptSha256",
    "receiptChain",
    "state",
    "finalLogSha256",
    "units",
    "coreCandidateSha256",
    "strippedCandidateSha256",
    "packageSha256",
    "packageEntries",
    "armVectors",
    "fixedCandidateJitResult",
    "completeInputsAndObjectsRecomputed",
    "operationsRequireVerifiedTransport",
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ]);
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.purpose, "fresh-native-final-state-verification-not-runtime");
  assert.equal(r.sourceCommit, plan.identity.sourceCommit);
  assert.equal(r.sourceSha256, plan.identity.sourceSha256);
  assert.equal(r.inputsSha256, plan.identity.inputsSha256);
  assert.equal(r.finalReceiptSha256, expected.receiptSha256);
  assert.equal(r.finalLogSha256, expected.phaseLogSha256);
  assert.deepEqual(r.units, units);
  assert.equal(r.coreCandidateSha256, plan.identity.coreCandidateSha256);
  assert.match(r.strippedCandidateSha256, hex);
  assert.match(r.packageSha256, hex);
  assert.ok(
    Number.isSafeInteger(r.packageEntries) &&
      r.packageEntries > 0 &&
      r.packageEntries <= 4096,
  );
  assert.equal(r.armVectors, 33);
  assert.equal(r.fixedCandidateJitResult, 11);
  assert.equal(r.completeInputsAndObjectsRecomputed, true);
  assert.equal(r.operationsRequireVerifiedTransport, true);
  exact(r.state, ["release", "assertions"]);
  for (const item of Object.values(r.state)) inventory(item);
  for (const key of [
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ])
    assert.equal(r[key], false);
  assert.deepEqual(r.receiptChain, [
    ...plan.identity.receipts,
    { phase: "final", sha256: expected.receiptSha256 },
  ]);
  const p = value.provenance;
  exact(p, [
    "verificationId",
    "checkpointModuleSha256",
    "abiModuleSha256",
    "finalLogSha256",
    "exclusiveWriterRequired",
    "outerWatchdogRequired",
    "memoryLimitBytes",
    "zstandardSupported",
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ]);
  assert.equal(p.verificationId, sha(plan.planSha256 + ":" + stageName));
  assert.equal(
    p.checkpointModuleSha256,
    plan.identity.scriptPins["native-llvm-checkpoint.mjs"],
  );
  assert.equal(
    p.abiModuleSha256,
    plan.identity.scriptPins["check-llvm-package.mjs"],
  );
  assert.equal(p.finalLogSha256, expected.phaseLogSha256);
  assert.equal(p.exclusiveWriterRequired, true);
  assert.equal(p.outerWatchdogRequired, true);
  assert.equal(p.memoryLimitBytes, 14 * 1024 ** 3);
  assert.equal(p.zstandardSupported, false);
  for (const key of [
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ])
    assert.equal(p[key], false);
  return r;
}

/** Root must additionally prove actual effective build/source/closure/capsule,
 * whole paginated CloudWatch log marker ordering and cleanup, and independently
 * collected ECR raw config/manifest bytes. This pure validator alone cannot
 * distinguish fabricated synthetic records from actual execution evidence.
 * Outer five flags remain false; a native final receipt requires its REAL
 * unit/package flags true. Neither condition asserts runtime/deployment.
 */
export function validateFreshNativeFinalCompleted(
  completed,
  expected,
  plan,
  input,
  transport,
) {
  exact(expected, [
    "buildId",
    "planSha256",
    "requestSha256",
    "buildspecSha256",
    "imageDigest",
    "imageConfigDigest",
    "receiptSha256",
    "phaseLogSha256",
  ]);
  assert.match(
    expected.buildId,
    /^vaettir-api-build:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );
  for (const name of [
    "planSha256",
    "requestSha256",
    "buildspecSha256",
    "receiptSha256",
    "phaseLogSha256",
  ])
    assert.match(expected[name], hex);
  for (const name of ["imageDigest", "imageConfigDigest"])
    assert.match(expected[name], digest);
  assert.deepEqual(planNativeFreshFinal(input), plan);
  assert.equal(plan.planSha256, expected.planSha256);
  assert.equal(plan.requestSha256, expected.requestSha256);
  assert.equal(plan.buildspecSha256, expected.buildspecSha256);
  exact(completed, [
    "schemaVersion",
    "purpose",
    "status",
    ...Object.keys(expected),
    "sourceCommit",
    "sourceSha256",
    "capsuleSha256",
    "verified",
    "receiptChain",
    "registryManifest",
    "registryConfigBase64",
    ...Object.keys(outerFalse),
  ]);
  assert.ok(Buffer.byteLength(JSON.stringify(completed)) <= 2 * 1024 ** 2);
  assert.equal(completed.schemaVersion, 1);
  assert.equal(completed.purpose, "completed-fresh-native-final");
  assert.equal(completed.status, "SUCCEEDED");
  for (const key of Object.keys(expected))
    assert.equal(completed[key], expected[key]);
  for (const key of Object.keys(outerFalse))
    assert.equal(completed[key], false);
  assert.equal(completed.sourceCommit, plan.identity.sourceCommit);
  assert.equal(completed.sourceSha256, plan.identity.sourceSha256);
  assert.equal(completed.capsuleSha256, plan.identity.capsule.sha256);
  exact(transport, ["phaseLogBytes", "phaseLogChunks"]);
  assert.ok(
    Buffer.isBuffer(transport.phaseLogBytes) &&
      transport.phaseLogBytes.length > 0 &&
      transport.phaseLogBytes.length <= 16777216,
  );
  assert.equal(sha(transport.phaseLogBytes), expected.phaseLogSha256);
  const stream = reassembleNativeFreshFinalLog(transport.phaseLogChunks, {
    phase: "final",
    planSha256: expected.planSha256,
    phaseLogSha256: expected.phaseLogSha256,
  });
  assert.deepEqual(stream.bytes, transport.phaseLogBytes);
  const units = readFinalUnitStreams(stream.bytes);
  const v = completed.verified;
  exact(v, [
    "planSha256",
    "pre",
    "image",
    "imageDigest",
    "imageConfigDigest",
    "registryRawConfigSha256",
    "actualPrecommitAndCommittedImageVerified",
    "digestPullEvidence",
    ...Object.keys(outerFalse),
  ]);
  assert.equal(v.planSha256, plan.planSha256);
  assert.equal(v.imageDigest, expected.imageDigest);
  assert.equal(v.imageConfigDigest, expected.imageConfigDigest);
  assert.equal(v.registryRawConfigSha256, expected.imageConfigDigest.slice(7));
  assert.equal(v.actualPrecommitAndCommittedImageVerified, true);
  assert.equal(
    v.digestPullEvidence,
    false,
    "Local pre-push image verification is not digest-pull evidence",
  );
  for (const key of Object.keys(outerFalse)) assert.equal(v[key], false);
  const raw = base64(v.pre.finalReceiptBase64, 32768);
  assert.equal(sha(raw), expected.receiptSha256);
  const receipt = parseFinalJson(raw);
  exact(receipt, [
    "schemaVersion",
    "purpose",
    "phase",
    "predecessorSha256",
    "inputs",
    "inputsSha256",
    "state",
    "proof",
    ...Object.keys(outerFalse),
  ]);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.purpose, "llvm-builder-checkpoint-not-runtime");
  assert.equal(receipt.phase, "final");
  assert.equal(
    receipt.predecessorSha256,
    plan.identity.expectedParent.receiptSha256,
  );
  assert.deepEqual(receipt.inputs, plan.identity.inputs);
  assert.equal(receipt.inputsSha256, plan.identity.inputsSha256);
  assert.equal(receipt.inputsSha256, sha(JSON.stringify(receipt.inputs)));
  assert.equal(
    receipt.unitAcceptance,
    true,
    "Actual original dual unit gates required",
  );
  assert.equal(
    receipt.packageAcceptance,
    true,
    "Actual original package gates required",
  );
  for (const key of [
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ])
    assert.equal(receipt[key], false);
  exact(receipt.proof, [
    "abiReceiptSha256",
    "packageSha256",
    "unitReceiptSha256",
    "llvm-abi.json",
    "llvm-cpu-jit",
    "llvm-arm-policy",
    "llvm-release-configuration.json",
    "llvm-assertions-configuration.json",
  ]);
  for (const value of Object.values(receipt.proof)) assert.match(value, hex);
  const pre = stage(v.pre, "pre", plan, expected, raw, units),
    image = stage(v.image, "image", plan, expected, raw, units);
  assert.deepEqual(
    pre,
    image,
    "Two independent actual native reviews must agree",
  );
  assert.deepEqual(receipt.state, pre.state);
  assert.equal(receipt.proof.packageSha256, pre.packageSha256);
  assert.ok(
    Array.isArray(completed.receiptChain) &&
      completed.receiptChain.length === 7,
  );
  const parentRecords = input.completedPhases.at(-1).completed.receiptChain;
  assert.deepEqual(completed.receiptChain.slice(0, 6), parentRecords);
  const last = completed.receiptChain.at(-1);
  exact(last, ["phase", "sha256", "base64"]);
  assert.equal(last.phase, "final");
  assert.equal(last.sha256, expected.receiptSha256);
  assert.deepEqual(base64(last.base64, 32768), raw);
  const registry = completed.registryManifest;
  exact(registry, ["images", "failures"]);
  assert.deepEqual(registry.failures, []);
  assert.ok(Array.isArray(registry.images) && registry.images.length === 1);
  const record = registry.images[0];
  assert.equal(record.imageId.imageDigest, expected.imageDigest);
  assert.equal(record.imageId.imageTag, plan.candidateImage.split(":").at(-1));
  assert.ok(
    typeof record.imageManifest === "string" &&
      Buffer.byteLength(record.imageManifest) <= 2097152,
  );
  assert.equal("sha256:" + sha(record.imageManifest), expected.imageDigest);
  const manifest = parseFinalJson(Buffer.from(record.imageManifest), 2097152);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(
    manifest.mediaType,
    "application/vnd.docker.distribution.manifest.v2+json",
  );
  assert.equal(manifest.config.digest, expected.imageConfigDigest);
  assert.ok(
    Array.isArray(manifest.layers) &&
      manifest.layers.length > 0 &&
      manifest.layers.length <= 100,
  );
  let layerBytes = 0;
  for (const layer of manifest.layers) {
    assert.match(layer.digest, digest);
    assert.ok(Number.isSafeInteger(layer.size) && layer.size > 0);
    layerBytes += layer.size;
  }
  assert.ok(Number.isSafeInteger(layerBytes) && layerBytes < 16 * 1024 ** 3);
  const configRaw = base64(completed.registryConfigBase64, 262144);
  assert.equal("sha256:" + sha(configRaw), expected.imageConfigDigest);
  const config = parseFinalJson(configRaw, 262144);
  assert.equal(config.os, "linux");
  assert.equal(config.architecture, "amd64");
  const labels = config.config.Labels;
  for (const [key, value] of Object.entries({
    "vaettir.source-commit": plan.identity.sourceCommit,
    "vaettir.source-sha256": plan.identity.sourceSha256,
    "vaettir.prepare-plan": plan.identity.preparePlanSha256,
    "vaettir.continuation-plan": plan.planSha256,
    "vaettir.continuation-phase": "final",
    "vaettir.runtime-eligible": "false",
    "vaettir.artifact-purpose": "llvm-builder-checkpoint",
    "vaettir.final-owner": plan.planSha256,
  }))
    assert.equal(labels[key], value);
  assert.ok(Array.isArray(config.config.Env));
  assert.deepEqual(
    config.config.Env.filter(
      (item) =>
        typeof item === "string" && item.startsWith("PYTHONDONTWRITEBYTECODE="),
    ),
    ["PYTHONDONTWRITEBYTECODE=1"],
  );
  return {
    phase: "final",
    finalReceiptSha256: expected.receiptSha256,
    imageDigest: expected.imageDigest,
    imageConfigDigest: expected.imageConfigDigest,
    phaseLogSha256: expected.phaseLogSha256,
    units,
    actualNativeReviewMetadataConsistent: true,
    actualCloudEvidenceStillRequired: true,
    ...outerFalse,
  };
}
