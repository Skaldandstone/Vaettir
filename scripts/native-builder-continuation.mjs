// Pure planning only. Root independently binds live AWS/build/log evidence,
// persists intent before dispatch, and verifies every returned image digest.
// This module never starts a build, reads credentials, or accepts a runtime.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { nativeValidationShell } from "./native-builder-recovery.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
export const RECOVERED_PREPARE = Object.freeze({
  commit: "d3a952c5c3c407cba306f4da3de4a0cac2e0908e",
  sourceSha256: "0c437fd0939340136832b294bce0e3677746bce3c2aead44335bded13bf0aac2",
  recoveryBuildId: "vaettir-api-build:b3ca4377-a9ec-4ce9-9780-7754943b6b4f",
  buildspecSha256: "9835ef5c21a80f0164b0590f9c871bbd456ef7055785f2df44f6b4cc2bd56a71",
  imageDigest: "sha256:286d1f0af2b4c81b1c20592b2aac621b6b7ead6bcbf124065c2332326adb9c12",
  imageConfigDigest: "sha256:0bb2bcfc1bb22124c4ec56090f17506be74ea8a850051799498e866475f11f1e",
  receiptSha256: "54e96393c398f6a97f49f570de04fa758f18121aa2ebe90595f40ba29e38b09b",
  inputsSha256: "85508de607de73839715dfde6d03e35b9369aafd493147789186b4c54779386a",
  manifestSha256: "7b7ebef6344c969fef8233da3cbe0e0c9d1ee9971bb4ebd7de2776b733beafb1",
});
export const PREPARE_SCRIPT_HASHES = Object.freeze({
  "build-llvm-runtime.sh": "c5c97e29d3722314faf2d09cda17a495972df30ab003ac55e80b6d18f308a0b9",
  "native-llvm-checkpoint.mjs": "4e41d444db39ca0f9536e6c700f4a2cf46025d692f8bb85f114a188dac0db861",
  "native-build-concurrency.mjs": "14c6924355a16797927f376f7841e5554fd52a9210efba4c96a4d5e935b7795a",
  "fetch-runtime-vendor-sources.mjs": "2e17302ed4711f9fdf238749226c3d8ac9dd91cd7e9ba84e5dcaaa0001d0fa43",
  "runtime-vendor-sources.json": "9fe3a81df0157a5145e00648aa2ae0529706ed6e6970e0f1337734047acfec83",
  "check-llvm-package.mjs": "97223d718c40045c7a121827f0ef214195967953f2bd30b0bbdef70af16cd688",
  "check-llvm-jit.c": "4183a1d7b22f1a8e1fd6acdb94691a01e1a95dcea1274f3a192af02b955a1481",
  "check-llvm-arm-defaults.cpp": "3d4c2652b94993186b61975cef6f3c6944befcb23d26390b741713aa11231ad2",
  "reconcile-llvm-arm-unit-fixture.mjs": "af5e3bcbc1ba3775f92a13502bdf9b4735edbcccd4f24875277f64555a397102",
});

/** Bounded receipt parsing is not actual-state verification. The unchanged
 * recipe's begin/finish and disposable successor begin provide that gate. */
export function validateNativeCheckpointReceipt(bytes, expected) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 32768, "Bounded receipt bytes required");
  const hash = value => createHash("sha256").update(value).digest("hex");
  const hex = /^[a-f0-9]{64}$/;
  assert.match(expected.sha256, hex);
  assert.equal(hash(bytes), expected.sha256, "Exact receipt bytes required");
  const receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  assert.deepEqual(Object.keys(receipt).sort(), ["schemaVersion", "purpose", "phase", "predecessorSha256", "inputs", "inputsSha256", "state", "proof", "unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"].sort());
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.purpose, "llvm-builder-checkpoint-not-runtime");
  assert.ok(["prepare", "release-core", "release-units", "assertion-compile-1", "assertion-compile-2", "assertion-compile-3", "final"].includes(expected.phase), "Supported checkpoint phase required");
  assert.equal(receipt.phase, expected.phase);
  assert.equal(receipt.predecessorSha256, expected.predecessorSha256);
  if (expected.phase === "prepare") assert.equal(expected.predecessorSha256, null);
  else assert.match(expected.predecessorSha256, hex);
  assert.match(receipt.inputsSha256, hex);
  assert.equal(receipt.inputsSha256, hash(JSON.stringify(receipt.inputs)));
  if (expected.inputsSha256 !== undefined) assert.equal(receipt.inputsSha256, expected.inputsSha256, "Mixed source/toolchain/configuration refused");
  const inventory = value => {
    assert.deepEqual(Object.keys(value).sort(), ["sha256", "entries", "bytes"].sort());
    assert.match(value.sha256, hex);
    assert.ok(Number.isSafeInteger(value.entries) && value.entries > 0 && value.entries <= 400000);
    assert.ok(Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 64 * 1024 ** 3);
  };
  for (const key of ["scripts", "signedSources", "source"]) inventory(receipt.inputs[key]);
  assert.deepEqual(Object.keys(receipt.state).sort(), ["release", "assertions"].sort());
  inventory(receipt.state.release); inventory(receipt.state.assertions);
  assert.equal(receipt.inputs.configuration.length, 2);
  for (const item of receipt.inputs.configuration) { assert.match(item.cache, hex); assert.match(item.commands, hex); }
  assert.match(receipt.inputs.baselineSha256, hex); assert.match(receipt.inputs.assertionPlanSha256, hex);
  assert.match(receipt.inputs.toolchain.compilerSha256, hex);
  assert.match(receipt.inputs.toolchain.installedPackagesSha256, hex);
  assert.equal(receipt.inputs.toolchain.compilerPackage, "1:19.1.7-3+b1");
  assert.ok(typeof receipt.inputs.toolchain.compiler === "string" && Buffer.byteLength(receipt.inputs.toolchain.compiler) <= 1024);
  assert.match(receipt.inputs.toolchain.compiler, /^Debian clang version 19\.1\.7(?: |$)/);
  assert.equal(receipt.unitAcceptance, expected.phase === "final");
  assert.equal(receipt.packageAcceptance, expected.phase === "final");
  for (const key of ["runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"]) assert.equal(receipt[key], false);
  if (["release-core", "final"].includes(expected.phase)) assert.match(receipt.proof.abiReceiptSha256, hex);
  if (expected.phase === "prepare") assert.deepEqual(receipt.proof, {});
  return receipt;
}

export function validateRecoveredNativePrepare(completed) {
  assert.ok(completed && Buffer.byteLength(JSON.stringify(completed)) <= 65536, "Bounded independent recovery evidence required");
  const pin = RECOVERED_PREPARE;
  assert.equal(completed.status, "SUCCEEDED"); assert.equal(completed.buildId, pin.recoveryBuildId);
  for (const [key, value] of Object.entries({ sourceCommit: pin.commit, sourceSha256: pin.sourceSha256, imageDigest: pin.imageDigest, imageConfigDigest: pin.imageConfigDigest, prepareReceiptSha256: pin.receiptSha256, buildspecSha256: pin.buildspecSha256 })) assert.equal(completed[key], value);
  const proof = completed.proof;
  assert.equal(proof.schemaVersion, 4); assert.equal(proof.purpose, "recover-verified-builder-only-artifact");
  assert.equal(proof.commit, pin.commit); assert.equal(proof.sourceSha256, pin.sourceSha256);
  assert.equal(proof.imageDigest, pin.imageDigest); assert.equal(proof.imageConfigDigest, pin.imageConfigDigest);
  assert.equal(proof.prepareReceiptSha256, pin.receiptSha256); assert.equal(proof.expectedManifest, pin.manifestSha256);
  assert.deepEqual(proof.expectedScripts, PREPARE_SCRIPT_HASHES);
  assert.equal(proof.originalBuildId, "vaettir-api-build:ec963576-90c3-4c11-8ae6-899a71d28357");
  assert.equal(proof.priorRecoveryBuildId, "vaettir-api-build:f390c136-7a1a-48c1-8792-c06200af4b81");
  assert.equal(proof.originalBuildStatus, "FAILED");
  assert.equal(proof.hardenedHelperSha256, "c6cfa748761c4516978f842f0189669b835827727f18a3edd37b423a5ef3b660");
  assert.equal(proof.independentCoreContext?.transferableAcceptance, false, "Diagnostic core is not a donor");
  assert.equal(proof.validation, "actual-pinned-inputs-and-state-recomputed");
  assert.equal(proof.validatedInsideDisposableNetworkNoneContainer, true);
  for (const value of [completed, proof]) for (const key of ["compiledAcceptance", "unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"]) assert.equal(value[key], false);
  assert.ok(typeof proof.receiptBase64 === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(proof.receiptBase64));
  const bytes = Buffer.from(proof.receiptBase64, "base64");
  assert.equal(bytes.toString("base64"), proof.receiptBase64, "Canonical receipt encoding required");
  const receipt = validateNativeCheckpointReceipt(bytes, { phase: "prepare", sha256: pin.receiptSha256, predecessorSha256: null, inputsSha256: pin.inputsSha256 });
  assert.deepEqual(completed.prepareReceipt, receipt);
  return receipt;
}

/** Refuse forecasts from a different compiler budget. Probe authorization is
 * external; an explicit probe can measure this budget but promises no success. */
export function nativeContinuationBudget(budget) {
  assert.ok(budget && typeof budget === "object");
  assert.deepEqual(Object.keys(budget).sort(), ["mode", "compilerJobs", "measuredCoreSeconds", "measuredTransportSeconds", "measuredInventorySeconds", "compileSeconds", "totalSeconds"].sort());
  assert.ok(["measured", "bounded-probe"].includes(budget.mode));
  assert.equal(budget.compilerJobs, 5, "Unchanged 8 CPU / 14 GiB allocator permits five compiler jobs");
  for (const key of ["measuredCoreSeconds", "measuredTransportSeconds", "measuredInventorySeconds", "compileSeconds", "totalSeconds"]) assert.ok(Number.isSafeInteger(budget[key]) && budget[key] >= 0);
  assert.ok(budget.compileSeconds >= 60 && budget.compileSeconds <= 2100);
  assert.ok(budget.totalSeconds > budget.compileSeconds && budget.totalSeconds <= 2520);
  assert.ok(budget.measuredTransportSeconds > 0 && budget.measuredInventorySeconds > 0, "Measured import/proof budget required even for a compile probe");
  assert.ok(budget.totalSeconds >= budget.compileSeconds + budget.measuredTransportSeconds + budget.measuredInventorySeconds + 60, "Measured transfer/inventory/cleanup budget required");
  if (budget.mode === "measured") {
    assert.ok(budget.measuredCoreSeconds > 0 && budget.measuredTransportSeconds > 0 && budget.measuredInventorySeconds > 0);
    assert.ok(budget.compileSeconds >= budget.measuredCoreSeconds + 120, "Measured compiler headroom required");
    assert.ok(budget.totalSeconds >= budget.compileSeconds + budget.measuredTransportSeconds + budget.measuredInventorySeconds + 60, "Measured transfer/inventory/cleanup budget required");
  } else assert.equal(budget.measuredCoreSeconds, 0, "Unmeasured probe cannot borrow another job budget's compile timing");
  return Object.freeze({ ...budget, cpus: 8, memoryBytes: 14 * 1024 ** 3, unitAcceptance: false, runtimeAcceptance: false });
}

/** Transport only reviewed bytes, not a filename or an ambient shell variable. */
export function packNativeContinuationOperation(operation) {
  assert.ok(typeof operation === "string");
  const bytes = Buffer.from(operation, "utf8");
  assert.ok(bytes.length > 0 && bytes.length <= 512 * 1024);
  assert.match(operation, /^timeout --signal=TERM --kill-after=30s [0-9]+s bash -eu -o pipefail -c '/);
  const compressed = gzipSync(bytes, { level: 9 });
  assert.ok(compressed.length <= 128 * 1024);
  return { encoding: "gzip-base64-sha256-v1", decodedSha256: sha(bytes), decodedBytes: bytes.length, compressedSha256: sha(compressed), compressedBytes: compressed.length, base64: compressed.toString("base64") };
}
export function unpackNativeContinuationOperation(packed) {
  assert.deepEqual(Object.keys(packed).sort(), ["encoding", "decodedSha256", "decodedBytes", "compressedSha256", "compressedBytes", "base64"].sort());
  assert.equal(packed.encoding, "gzip-base64-sha256-v1");
  for (const key of ["decodedSha256", "compressedSha256"]) assert.match(packed[key], /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(packed.decodedBytes) && packed.decodedBytes > 0 && packed.decodedBytes <= 512 * 1024);
  assert.ok(Number.isSafeInteger(packed.compressedBytes) && packed.compressedBytes > 0 && packed.compressedBytes <= 128 * 1024);
  assert.ok(typeof packed.base64 === "string" && packed.base64.length <= 176000 && /^[A-Za-z0-9+/]*={0,2}$/.test(packed.base64));
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const compressed = Buffer.from(packed.base64, "base64");
  assert.equal(compressed.toString("base64"), packed.base64);
  assert.equal(compressed.length, packed.compressedBytes);
  assert.equal(hash(compressed), packed.compressedSha256, "Compressed reviewed operation changed");
  const bytes = gunzipSync(compressed, { maxOutputLength: 512 * 1024 });
  assert.equal(bytes.length, packed.decodedBytes);
  assert.equal(hash(bytes), packed.decodedSha256, "Decoded reviewed operation changed");
  const operation = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.match(operation, /^timeout --signal=TERM --kill-after=30s [0-9]+s bash -eu -o pipefail -c '/);
  return operation;
}

/** First actual continuation only. Later phases remain separate reviewed gates;
 * no unchecked core-only donor can reach the default runtime package graph. */
export function planNativeCoreContinuation({ completedRecovery, budget, phase = "release-core" }) {
  assert.equal(phase, "release-core", "Only reviewed prepare→release-core transport is supported");
  validateRecoveredNativePrepare(completedRecovery);
  const resources = nativeContinuationBudget(budget), pin = RECOVERED_PREPARE;
  const registry = "051722405355.dkr.ecr.us-east-2.amazonaws.com", repository = `${registry}/vaettir-api`;
  const image = `${repository}@${pin.imageDigest}`;
  const plannerSemanticsSha256 = sha([planNativeCoreContinuation, validateNativeCheckpointReceipt, validateRecoveredNativePrepare, nativeContinuationBudget, packNativeContinuationOperation, unpackNativeContinuationOperation, nativeValidationShell, quote, sha].map(fn => fn.toString()).join("\n"));
  const identity = { schemaVersion: 1, purpose: "builder-only-native-core-continuation", transportEncoding: "gzip-base64-sha256-v1", plannerSemanticsSha256, phase, sourceCommit: pin.commit, sourceSha256: pin.sourceSha256, predecessorImageDigest: pin.imageDigest, predecessorReceiptSha256: pin.receiptSha256, recoveryBuildId: pin.recoveryBuildId, resources };
  const planSha256 = sha(JSON.stringify(identity)), tag = `native-core-${pin.commit.slice(0, 12)}-${planSha256.slice(0, 24)}`, candidate = `${repository}:${tag}`;
  const common = `const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');const sha=b=>createHash('sha256').update(b).digest('hex');const bounded=(p,n)=>{const s=fs.lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=n);return fs.readFileSync(p)};`;
  const parser = validateNativeCheckpointReceipt.toString();
  const pre = `${common}const hashes=${JSON.stringify(PREPARE_SCRIPT_HASHES)};for(const [name,h]of Object.entries(hashes))assert.equal(sha(bounded('/build/scripts/'+name,1048576)),h);assert.equal(sha(bounded('/build/llvm-sources/source-manifest.json',65536)),${quote(pin.manifestSha256)});assert.equal(sha(bounded('/build/llvm-phase-receipts/prepare.json',32768)),${quote(pin.receiptSha256)});const jobs=require('node:child_process').execFileSync(process.execPath,['/build/scripts/native-build-concurrency.mjs'],{encoding:'utf8',timeout:30000,maxBuffer:4096}).trim();assert.equal(jobs,'5','Exact measured compiler budget required');`;
  const post = `${common}${parser};const b=bounded('/build/llvm-phase-receipts/release-core.json',32768);const r=validateNativeCheckpointReceipt(b,{phase:'release-core',sha256:sha(b),predecessorSha256:${quote(pin.receiptSha256)},inputsSha256:${quote(pin.inputsSha256)}});console.log('NATIVE_CONTINUATION_CORE='+JSON.stringify({planSha256:${quote(planSha256)},receiptSha256:sha(b),receiptBase64:b.toString('base64'),unitAcceptance:false,packageAcceptance:false,runtimeAcceptance:false}));`;
  const compile = `set -eu; node -e ${quote(pre)}; sh /build/scripts/build-llvm-runtime.sh --phase release-core --predecessor-sha256 ${pin.receiptSha256}; node -e ${quote(post)}`;
  const manifest = `${common}const x=JSON.parse(bounded('native-continuation-proof/parent-manifest.json',2097152));assert.deepEqual(x.failures??[],[]);assert.equal(x.images.length,1);const i=x.images[0];assert.equal(i.imageId.imageDigest,${quote(pin.imageDigest)});assert.equal('sha256:'+sha(i.imageManifest),${quote(pin.imageDigest)});const m=JSON.parse(i.imageManifest);assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');assert.equal(m.config.digest,${quote(pin.imageConfigDigest)});assert.ok(m.layers.length>0&&m.layers.length<=100);assert.ok(m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<2147483648);`;
  const inspect = `${common}const [i]=JSON.parse(bounded('native-continuation-proof/parent-inspect.json',2097152));assert.equal(i.Id,${quote(pin.imageConfigDigest)});assert.ok(i.RepoDigests.includes(${quote(image)}));assert.equal(i.Config.Labels['vaettir.source-commit'],${quote(pin.commit)});assert.equal(i.Config.Labels['vaettir.runtime-eligible'],'false');assert.equal(i.Config.Labels['vaettir.artifact-purpose'],'llvm-builder-checkpoint');assert.ok(Number.isSafeInteger(i.Size)&&i.Size>0&&i.Size<64*1024**3);`;
  const container = `${common}const values=JSON.parse(bounded('native-continuation-proof/compiler-inspect.json',2097152));assert.equal(values.length,1);const [i]=values;assert.equal(i.Image,${quote(pin.imageConfigDigest)});assert.equal(i.Config.Labels['vaettir.continuation-owner'],${quote(planSha256)});assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(i.HostConfig.Privileged,false);assert.deepEqual(i.HostConfig.CapDrop,['ALL']);assert.ok(i.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(i.HostConfig.Memory,15032385536);assert.equal(i.HostConfig.NanoCpus,8000000000);assert.equal(i.HostConfig.PidsLimit,2048);assert.deepEqual(i.Mounts,[]);`;
  const collect = `${common}${parser};const lines=bounded('native-continuation-proof/compile.log',16777216).toString('utf8').split(RegExp(String.fromCharCode(13)+'?'+String.fromCharCode(10))).filter(l=>l.startsWith('NATIVE_CONTINUATION_CORE='));assert.equal(lines.length,1);const p=JSON.parse(lines[0].slice('NATIVE_CONTINUATION_CORE='.length));assert.equal(p.planSha256,${quote(planSha256)});const b=bounded('native-continuation-proof/release-core.json',32768);assert.equal(p.receiptBase64,b.toString('base64'));assert.equal(p.receiptSha256,sha(b));validateNativeCheckpointReceipt(b,{phase:'release-core',sha256:p.receiptSha256,predecessorSha256:${quote(pin.receiptSha256)},inputsSha256:${quote(pin.inputsSha256)}});for(const k of ['unitAcceptance','packageAcceptance','runtimeAcceptance'])assert.equal(p[k],false);fs.writeFileSync('native-continuation-proof/core-proof.json',JSON.stringify(p)+String.fromCharCode(10),{flag:'wx'});`;
  const successor = `${common}${parser};const b=bounded('/build/llvm-phase-receipts/release-core.json',32768);validateNativeCheckpointReceipt(b,{phase:'release-core',sha256:sha(b),predecessorSha256:${quote(pin.receiptSha256)},inputsSha256:${quote(pin.inputsSha256)}});(async()=>{const {checkpointStore}=await import('/build/scripts/native-llvm-checkpoint.mjs');checkpointStore().begin('release-units',sha(b));console.log('NATIVE_CONTINUATION_STATE='+JSON.stringify({planSha256:${quote(planSha256)},receiptSha256:sha(b),actualStateVerified:true,runtimeAcceptance:false}))})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1});`;
  const readId = `${common}const b=bounded('native-continuation-proof/container-id',65).toString('utf8').trim();assert.match(b,/^[a-f0-9]{64}$/);process.stdout.write(b);`;
  const readCommitId = `${common}const id=bounded('native-continuation-proof/commit-id.txt',72).toString('utf8').trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);process.stdout.write(id);`;
  const verifierInspect = `${common}const id=bounded('native-continuation-proof/commit-id.txt',72).toString('utf8').trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);const values=JSON.parse(bounded('native-continuation-proof/verifier-inspect.json',2097152));assert.equal(values.length,1);const [i]=values;assert.equal(i.Image,id);assert.equal(i.Config.Image,id);assert.equal(i.Config.Labels['vaettir.continuation-owner'],${quote(planSha256)});assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(i.HostConfig.Privileged,false);assert.deepEqual(i.HostConfig.CapDrop,['ALL']);assert.ok(i.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(i.HostConfig.Memory,2147483648);assert.equal(i.HostConfig.NanoCpus,2000000000);assert.equal(i.HostConfig.PidsLimit,128);assert.deepEqual(i.Mounts,[]);`;
  const candidateCheck = `${common}const id=bounded('native-continuation-proof/commit-id.txt',72).toString('utf8').trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);const values=JSON.parse(bounded('native-continuation-proof/candidate-inspect.json',2097152));assert.equal(values.length,1);const [i]=values;assert.equal(i.Id,id);assert.equal(i.Config.Labels['vaettir.continuation-plan'],${quote(planSha256)});assert.equal(i.Config.Labels['vaettir.source-commit'],${quote(pin.commit)});assert.equal(i.Config.Labels['vaettir.runtime-eligible'],'false');assert.equal(i.Config.Labels['vaettir.artifact-purpose'],'llvm-builder-checkpoint');assert.ok(Number.isSafeInteger(i.Size)&&i.Size>0&&i.Size<64*1024**3);`;
  const disk = `available_bytes=$(df -PB1 /var/lib/docker | tail -1 | awk '{print $4}'); case "$available_bytes" in *[!0-9]*|'') exit 1 ;; esac; test "$available_bytes" -ge 77309411328`;
  const absent = `${common}const x=JSON.parse(bounded('native-continuation-proof/tag-preflight.json',2097152));assert.deepEqual(x.images,[]);assert.equal(x.failures?.length,1);assert.equal(x.failures[0].failureCode,'ImageNotFound');assert.equal(x.failures[0].imageId.imageTag,${quote(tag)});`;
  const readback = `${common}${parser};
const x=JSON.parse(bounded('native-continuation-proof/candidate-manifest.json',2097152));
assert.deepEqual(x.failures??[],[]);assert.equal(x.images.length,1);
const i=x.images[0],digest='sha256:'+sha(i.imageManifest);
assert.equal(i.imageId.imageDigest,digest);assert.equal(i.imageId.imageTag,${quote(tag)});
const m=JSON.parse(i.imageManifest);assert.equal(m.schemaVersion,2);
assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');
assert.ok(m.layers.length>0&&m.layers.length<=100&&m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));
assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<16*1024**3);
const committed=bounded('native-continuation-proof/commit-id.txt',72).toString('utf8').trim();
assert.match(committed,/^sha256:[a-f0-9]{64}$/);
const locals=JSON.parse(bounded('native-continuation-proof/candidate-inspect.json',2097152));assert.equal(locals.length,1);
const [local]=locals;assert.equal(local.Id,committed);assert.equal(m.config.digest,committed);
assert.ok(Number.isSafeInteger(local.Size)&&local.Size>0&&local.Size<64*1024**3);
assert.equal(local.Config.Labels['vaettir.continuation-plan'],${quote(planSha256)});
assert.equal(local.Config.Labels['vaettir.source-commit'],${quote(pin.commit)});
assert.equal(local.Config.Labels['vaettir.runtime-eligible'],'false');
assert.equal(local.Config.Labels['vaettir.artifact-purpose'],'llvm-builder-checkpoint');
const log=bounded('native-continuation-proof/push.log',1048576).toString('utf8');
const matches=[...log.matchAll(/digest: (sha256:[a-f0-9]{64})/g)];assert.equal(matches.length,1);assert.equal(matches[0][1],digest);
const proofs=bounded('native-continuation-proof/state.log',1048576).toString('utf8').split(RegExp(String.fromCharCode(13)+'?'+String.fromCharCode(10))).filter(l=>l.startsWith('NATIVE_CONTINUATION_STATE='));assert.equal(proofs.length,1);
const state=JSON.parse(proofs[0].slice('NATIVE_CONTINUATION_STATE='.length)),core=JSON.parse(bounded('native-continuation-proof/core-proof.json',65536));
assert.deepEqual(Object.keys(core).sort(),['planSha256','receiptSha256','receiptBase64','unitAcceptance','packageAcceptance','runtimeAcceptance'].sort());
assert.deepEqual(Object.keys(state).sort(),['planSha256','receiptSha256','actualStateVerified','runtimeAcceptance'].sort());
assert.equal(core.planSha256,${quote(planSha256)});assert.equal(state.planSha256,${quote(planSha256)});
const receiptBytes=bounded('native-continuation-proof/release-core.json',32768);
assert.equal(core.receiptBase64,receiptBytes.toString('base64'));assert.equal(core.receiptSha256,sha(receiptBytes));
validateNativeCheckpointReceipt(receiptBytes,{phase:'release-core',sha256:core.receiptSha256,predecessorSha256:${quote(pin.receiptSha256)},inputsSha256:${quote(pin.inputsSha256)}});
assert.equal(state.receiptSha256,core.receiptSha256);assert.equal(state.actualStateVerified,true);assert.equal(state.runtimeAcceptance,false);
for(const key of ['unitAcceptance','packageAcceptance','runtimeAcceptance'])assert.equal(core[key],false);
console.log('NATIVE_CONTINUATION_VERIFIED='+JSON.stringify({...core,sourceCommit:${quote(pin.commit)},sourceSha256:${quote(pin.sourceSha256)},predecessorImageDigest:${quote(pin.imageDigest)},predecessorReceiptSha256:${quote(pin.receiptSha256)},imageDigest:digest,imageConfigDigest:local.Id,actualStateVerified:true,authenticatedAcceptance:false,deploymentAcceptance:false}));`;
  const commands = [
    "trap 'exit 124' TERM", 'test "$CODEBUILD_BUILD_SUCCEEDING" = 1', 'timeout 20s docker info >/dev/null', 'mkdir native-continuation-proof', disk,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageDigest=${pin.imageDigest} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json > native-continuation-proof/parent-manifest.json`, `timeout 20s node -e ${quote(manifest)}`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${tag} --region us-east-2 --output json > native-continuation-proof/tag-preflight.json`, `timeout 20s node -e ${quote(absent)}`,
    `timeout 60s aws ecr get-login-password --region us-east-2 | timeout 60s docker login --username AWS --password-stdin ${registry}`,
    `timeout --signal=TERM --kill-after=20s 300s docker pull ${image}`, `timeout 20s docker image inspect ${image} > native-continuation-proof/parent-inspect.json`, `timeout 20s node -e ${quote(inspect)}`,
    'native_create_status=0', `timeout 30s docker create --cidfile native-continuation-proof/container-id --label vaettir.continuation-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --entrypoint sh ${image} -eu -c ${quote(compile)} >native-continuation-proof/create-output.txt || native_create_status=$?`, `native_validation_container=$(timeout 20s node -e ${quote(readId)})`, 'test "$native_create_status" = 0', 'timeout 20s docker inspect "$native_validation_container" > native-continuation-proof/compiler-inspect.json', `timeout 20s node -e ${quote(container)}`,
    `timeout --signal=TERM --kill-after=20s ${resources.compileSeconds}s docker start -a "$native_validation_container" | tee native-continuation-proof/compile.log`, 'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_validation_container")" = 0', 'timeout 30s docker cp "$native_validation_container:/build/llvm-phase-receipts/release-core.json" native-continuation-proof/release-core.json', `timeout 20s node -e ${quote(collect)}`,
    `timeout 180s docker commit --change ${quote(`LABEL vaettir.continuation-plan=${planSha256}`)} "$native_validation_container" ${candidate} > native-continuation-proof/commit-id.txt`, 'cleanup_native_validation', "native_validation_container=''", 'rm -- native-continuation-proof/container-id',
    `native_candidate_image=$(timeout 20s node -e ${quote(readCommitId)})`, 'native_create_status=0', `timeout 30s docker create --cidfile native-continuation-proof/container-id --label vaettir.continuation-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 2g --cpus 2 --entrypoint node "$native_candidate_image" -e ${quote(successor)} >native-continuation-proof/verify-create-output.txt || native_create_status=$?`, `native_validation_container=$(timeout 20s node -e ${quote(readId)})`, 'test "$native_create_status" = 0', 'timeout 20s docker inspect "$native_validation_container" > native-continuation-proof/verifier-inspect.json', `timeout 20s node -e ${quote(verifierInspect)}`, 'timeout --signal=TERM --kill-after=20s 240s docker start -a "$native_validation_container" | tee native-continuation-proof/state.log', 'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_validation_container")" = 0', 'cleanup_native_validation', "native_validation_container=''",
    `timeout 20s docker image inspect ${candidate} > native-continuation-proof/candidate-inspect.json`, `timeout 20s node -e ${quote(candidateCheck)}`, `timeout --signal=TERM --kill-after=20s 180s docker push ${candidate} | tee native-continuation-proof/push.log`, `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${tag} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json > native-continuation-proof/candidate-manifest.json`, `timeout 20s node -e ${quote(readback)}`,
  ];
  const operation = `timeout --signal=TERM --kill-after=30s ${resources.totalSeconds}s ${nativeValidationShell(commands)}`;
  assert.doesNotMatch(operation, /describe-images|put-object|put-role-policy|update-project|ecs |rds |migrate|:latest|check-llvm-unit/);
  const transport = packNativeContinuationOperation(operation);
  const decoder = `const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{gunzipSync}=require('node:zlib'),{spawnSync}=require('node:child_process');${unpackNativeContinuationOperation.toString()};const operation=unpackNativeContinuationOperation(${JSON.stringify(transport)});const r=spawnSync('/bin/bash',['-eu','-o','pipefail','-c',operation],{stdio:'inherit',timeout:${(resources.totalSeconds + 60) * 1000},killSignal:'SIGTERM'});if(r.error)throw r.error;assert.equal(r.signal,null);assert.equal(r.status,0,'Reviewed native operation failed');`;
  const buildspec = { version: "0.2", phases: { build: { commands: [`node -e ${quote(decoder)}`] }, post_build: { commands: ['test "$CODEBUILD_BUILD_SUCCEEDING" = 1', 'echo "BUILDER CORE ONLY: complete release/assertion units, package/runtime/image-security/deployment remain unaccepted."'] } } };
  const request = { projectName: "vaettir-api-build", sourceTypeOverride: "S3", sourceLocationOverride: `vaettir-build-source-051722405355/releases/${pin.commit}/source.zip`, buildspecOverride: JSON.stringify(buildspec), timeoutInMinutesOverride: 45, computeTypeOverride: "BUILD_GENERAL1_LARGE", environmentVariablesOverride: [{ name: "VAETTIR_RELEASE_COMMIT", value: pin.commit, type: "PLAINTEXT" }] };
  request.idempotencyToken = `native-core-${planSha256.slice(0, 40)}`;
  assert.ok(request.buildspecOverride.length <= 25600 && Buffer.byteLength(request.buildspecOverride, "utf8") <= 25600, "CodeBuild 25600-byte buildspec limit required before dispatch");
  return { ...identity, planSha256, request, requestSha256: sha(JSON.stringify(request)), transport, operation, generatedPrograms: { pre, post, manifest, inspect, container, collect, successor, readId, readCommitId, verifierInspect, candidateCheck, absent, readback, decoder }, candidateTag: tag, importedImage: image, defaultRuntimeGraphChanged: false, compiledAcceptance: false, unitAcceptance: false, packageAcceptance: false, runtimeAcceptance: false, authenticatedAcceptance: false, deploymentAcceptance: false, dispatchRequiresRootPreflight: true, forecastAcceptance: budget.mode === "measured", remainingGates: ["Release-core receipt/image proof must be collected from actual successful build", "Later phase transport and final verifier are not implemented here", "Both complete check-llvm-unit suites and final package/ABI/ARM/JIT gates remain compulsory", "Default runtime still cannot inherit this builder; image scan and authenticated release acceptance remain separate"] };
}
