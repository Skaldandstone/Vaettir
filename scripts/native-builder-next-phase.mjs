// Pure immutable request planning. No AWS/Docker operation is performed here.
// A root collector must supply independently retained successful build evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  RECOVERED_PREPARE,
  PREPARE_SCRIPT_HASHES,
  validateNativeCheckpointReceipt,
  nativeContinuationBudget,
  packNativeContinuationOperation,
  unpackNativeContinuationOperation,
} from "./native-builder-continuation.mjs";
import { nativeValidationShell } from "./native-builder-recovery.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const phases = Object.freeze(["prepare", "release-core", "release-units", "assertion-compile-1", "assertion-compile-2", "assertion-compile-3", "final"]);
const registry = "051722405355.dkr.ecr.us-east-2.amazonaws.com";
const repository = registry + "/vaettir-api";
const hex = /^[a-f0-9]{64}$/;
const digest = /^sha256:[a-f0-9]{64}$/;

function objectKeys(value, keys) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), keys.slice().sort());
}
function receiptBytes(value) {
  objectKeys(value, ["phase", "sha256", "base64"]);
  assert.match(value.sha256, hex);
  assert.ok(typeof value.base64 === "string" && value.base64.length > 0 && value.base64.length <= 43692 && /^[A-Za-z0-9+/]*={0,2}$/.test(value.base64));
  const bytes = Buffer.from(value.base64, "base64");
  assert.equal(bytes.toString("base64"), value.base64);
  assert.equal(hash(bytes), value.sha256);
  return bytes;
}

/** This verifies retained metadata/bytes, not the running builder inventory.
 * The unchanged recipe and disposable successor.begin perform that gate. */
export function validateNativeNextPhaseParent(completed, expected, nextPhase) {
  const pin = RECOVERED_PREPARE;
  assert.ok(phases.includes(nextPhase) && phases.indexOf(nextPhase) >= 2 && nextPhase !== "final", "Final transport lacks an independent final-image verifier and is unsupported");
  objectKeys(expected, ["buildId", "planSha256", "requestSha256", "buildspecSha256", "imageDigest", "imageConfigDigest", "receiptSha256"]);
  assert.match(expected.buildId, /^vaettir-api-build:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  for (const key of ["planSha256", "requestSha256", "buildspecSha256", "receiptSha256"]) assert.match(expected[key], hex);
  for (const key of ["imageDigest", "imageConfigDigest"]) assert.match(expected[key], digest);
  assert.notEqual(expected.imageDigest, pin.imageDigest, "Prepare is not a compiled phase donor");
  assert.notEqual(expected.buildId, pin.recoveryBuildId);
  assert.ok(completed && Buffer.byteLength(JSON.stringify(completed)) <= 512 * 1024, "Bounded actual completed-parent evidence required");
  const evidenceKeys = ["schemaVersion", "purpose", "status", "buildId", "sourceCommit", "sourceSha256", "planSha256", "requestSha256", "buildspecSha256", "imageDigest", "imageConfigDigest", "receiptSha256", "receiptChain", "proof", "registryManifest", "imageInspection", "imageInspectionMode", "unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"];
  if (completed.imageInspectionMode === "REGISTRY_CONFIG_PINNED") evidenceKeys.push("registryConfigBase64");
  objectKeys(completed, evidenceKeys);
  assert.equal(completed.schemaVersion, 1);
  assert.equal(completed.purpose, "completed-native-builder-phase");
  assert.equal(completed.status, "SUCCEEDED", "An active/failed build is not a donor");
  for (const [key, value] of Object.entries(expected)) assert.equal(completed[key], value, "Externally retained parent identity required: " + key);
  assert.equal(completed.sourceCommit, pin.commit); assert.equal(completed.sourceSha256, pin.sourceSha256);
  for (const key of ["unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"]) assert.equal(completed[key], false);
  const parentIndex = phases.indexOf(nextPhase) - 1;
  assert.ok(Array.isArray(completed.receiptChain) && completed.receiptChain.length === parentIndex + 1);
  let predecessor = null, receipt;
  const chain = completed.receiptChain.map((record, index) => {
    assert.equal(record.phase, phases[index], "No skipped/reordered checkpoint ancestors");
    const bytes = receiptBytes(record);
    receipt = validateNativeCheckpointReceipt(bytes, { phase: record.phase, sha256: record.sha256, predecessorSha256: predecessor, inputsSha256: pin.inputsSha256 });
    if (index === 0) assert.equal(record.sha256, pin.receiptSha256, "Exact authenticated recovered prepare required");
    else if (record.phase === "release-core") objectKeys(receipt.proof, ["abiReceiptSha256"]);
    else assert.deepEqual(receipt.proof, {}, "Non-final compilation/unit checkpoint cannot claim package acceptance");
    predecessor = record.sha256;
    return { phase: record.phase, sha256: record.sha256, base64: record.base64 };
  });
  assert.equal(predecessor, expected.receiptSha256);
  const proof = completed.proof;
  assert.equal(proof.planSha256, expected.planSha256); assert.equal(proof.receiptSha256, predecessor);
  assert.equal(proof.receiptBase64, chain.at(-1).base64); assert.equal(proof.actualStateVerified, true);
  assert.equal(proof.sourceCommit, pin.commit); assert.equal(proof.sourceSha256, pin.sourceSha256);
  assert.equal(proof.imageDigest, expected.imageDigest); assert.equal(proof.imageConfigDigest, expected.imageConfigDigest);
  assert.equal(proof.predecessorReceiptSha256, receipt.predecessorSha256);
  assert.match(proof.predecessorImageDigest, digest);
  if (parentIndex === 1) assert.equal(proof.predecessorImageDigest, pin.imageDigest);
  else assert.equal(proof.phase, phases[parentIndex]);
  for (const key of ["unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"]) assert.equal(proof[key], false);
  const readback = completed.registryManifest;
  assert.ok(Buffer.byteLength(JSON.stringify(readback)) <= 2 * 1024 * 1024);
  assert.deepEqual(readback.failures ?? [], []); assert.equal(readback.images.length, 1);
  const image = readback.images[0]; assert.equal(image.imageId.imageDigest, expected.imageDigest);
  assert.ok(typeof image.imageManifest === "string" && Buffer.byteLength(image.imageManifest) <= 2 * 1024 * 1024);
  assert.equal("sha256:" + hash(image.imageManifest), expected.imageDigest);
  const manifest = JSON.parse(image.imageManifest);
  assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.mediaType, "application/vnd.docker.distribution.manifest.v2+json");
  assert.equal(manifest.config.digest, expected.imageConfigDigest);
  assert.ok(Array.isArray(manifest.layers) && manifest.layers.length > 0 && manifest.layers.length <= 100);
  let bytes = 0;
  for (const layer of manifest.layers) { assert.match(layer.digest, digest); assert.ok(Number.isSafeInteger(layer.size) && layer.size > 0); bytes += layer.size; assert.ok(Number.isSafeInteger(bytes) && bytes < 16 * 1024 ** 3); }
  assert.ok(["PRE_PUSH_CONFIG_PINNED", "DIGEST_PULLED", "REGISTRY_CONFIG_PINNED"].includes(completed.imageInspectionMode), "Explicit inspection provenance required");
  let labels;
  if (completed.imageInspectionMode === "REGISTRY_CONFIG_PINNED") {
    // The active core operation exports no Docker inspection artifact. These
    // are actual downloaded registry config bytes, NOT fabricated Id/Size or
    // RepoDigests. Local uncompressed size/digest-pull proof stays mandatory
    // in the next generated build before any recipe work.
    assert.equal(completed.imageInspection, null, "Registry config evidence cannot fabricate a Docker inspection");
    const encoded = completed.registryConfigBase64;
    assert.ok(typeof encoded === "string" && encoded.length > 0 && encoded.length <= 349528 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), "Bounded canonical raw registry config required");
    const configBytes = Buffer.from(encoded, "base64");
    assert.ok(configBytes.length > 0 && configBytes.length <= 256 * 1024);
    assert.equal(configBytes.toString("base64"), encoded);
    const configDigest = "sha256:" + hash(configBytes);
    assert.equal(configDigest, expected.imageConfigDigest, "Raw registry config bytes must match the independent config digest");
    assert.equal(configDigest, manifest.config.digest, "Raw registry config bytes must match the actual manifest config digest");
    let config;
    try { config = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(configBytes)); }
    catch { throw new Error("Unsupported raw registry configuration encoding/JSON"); }
    assert.ok(config && typeof config === "object" && !Array.isArray(config));
    assert.equal(config.os, "linux"); assert.equal(config.architecture, "amd64");
    assert.equal(config.rootfs?.type, "layers");
    assert.ok(Array.isArray(config.rootfs.diff_ids) && config.rootfs.diff_ids.length === manifest.layers.length);
    for (const value of config.rootfs.diff_ids) assert.match(value, digest);
    labels = config.config?.Labels;
  } else {
    const inspection = completed.imageInspection;
    assert.ok(Buffer.byteLength(JSON.stringify(inspection)) <= 2 * 1024 * 1024);
    assert.equal(inspection.Id, expected.imageConfigDigest);
    assert.equal(inspection.Id, manifest.config.digest, "Local configuration must match actual post-push registry readback");
    assert.ok(Array.isArray(inspection.RepoDigests) && inspection.RepoDigests.length <= 100);
    for (const entry of inspection.RepoDigests) assert.ok(typeof entry === "string" && entry.length <= 1024);
    if (completed.imageInspectionMode === "DIGEST_PULLED" || inspection.RepoDigests.length > 0)
      assert.ok(inspection.RepoDigests.includes(repository + "@" + expected.imageDigest), "A claimed digest pull must match the independently pinned registry digest");
    assert.ok(Number.isSafeInteger(inspection.Size) && inspection.Size > 0 && inspection.Size < 64 * 1024 ** 3);
    labels = inspection.Config.Labels;
  }
  assert.ok(labels && typeof labels === "object" && !Array.isArray(labels));
  for (const [key, value] of Object.entries({ "vaettir.source-commit": pin.commit, "vaettir.artifact-purpose": "llvm-builder-checkpoint", "vaettir.runtime-eligible": "false", "vaettir.continuation-plan": expected.planSha256 })) assert.ok(labels[key] === value, "Native parent configuration label mismatch: " + key);
  return { receipt, chain, compressedBytes: bytes, expected: { ...expected }, parentPhase: phases[parentIndex], inspectionMode: completed.imageInspectionMode };
}

/** All supported phases remain incomplete builder artifacts. No partial release
 * suite or assertion object partition certifies full units, package or runtime. */
export function planNativeNextPhase({ completedParent, expectedParent, budget, phase }) {
  const parent = validateNativeNextPhaseParent(completedParent, expectedParent, phase);
  const resources = nativeContinuationBudget(budget), pin = RECOVERED_PREPARE;
  assert.equal(resources.mode, "bounded-probe", "No independently retained phase-specific performance measurement contract exists; core timing is not a next-phase forecast");
  const successorPhase = phases[phases.indexOf(phase) + 1];
  assert.ok(successorPhase, "No invented final successor");
  const semantics = hash([planNativeNextPhase, validateNativeNextPhaseParent, validateNativeCheckpointReceipt, objectKeys, receiptBytes, nativeContinuationBudget, packNativeContinuationOperation, unpackNativeContinuationOperation, nativeValidationShell, hash, quote].map(fn => fn.toString()).join("\n"));
  const identity = { schemaVersion: 1, purpose: "builder-only-native-next-phase", transportEncoding: "gzip-base64-sha256-v1", plannerSemanticsSha256: semantics, sourceCommit: pin.commit, sourceSha256: pin.sourceSha256, phase, successorPhase, expectedParent: parent.expected, parentInspectionMode: parent.inspectionMode, receiptChain: parent.chain.map(({ phase, sha256 }) => ({ phase, sha256 })), resources };
  const planSha256 = hash(JSON.stringify(identity)), tag = `native-${phase}-${planSha256.slice(0, 32)}`, candidate = repository + ":" + tag, image = repository + "@" + expectedParent.imageDigest;
  const common = `const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');const sha=b=>createHash('sha256').update(b).digest('hex');const bounded=(p,n)=>{const s=fs.lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=n);return fs.readFileSync(p)};`;
  const parser = validateNativeCheckpointReceipt.toString();
  const expected = { phase, predecessorSha256: expectedParent.receiptSha256, inputsSha256: pin.inputsSha256 };
  const parseCurrent = `const b=bounded('/build/llvm-phase-receipts/${phase}.json',32768);const receipt=validateNativeCheckpointReceipt(b,{...${JSON.stringify(expected)},sha256:sha(b)});assert.deepEqual(receipt.proof,{});`;
  const pre = `${common}${parser};const pins=${JSON.stringify(PREPARE_SCRIPT_HASHES)};for(const[n,h]of Object.entries(pins))assert.equal(sha(bounded('/build/scripts/'+n,1048576)),h);assert.equal(sha(bounded('/build/llvm-sources/source-manifest.json',65536)),${quote(pin.manifestSha256)});const chain=${JSON.stringify(parent.chain.map(({ phase, sha256 }) => ({ phase, sha256 })))};let prior=null;for(const c of chain){const b=bounded('/build/llvm-phase-receipts/'+c.phase+'.json',32768);validateNativeCheckpointReceipt(b,{phase:c.phase,sha256:c.sha256,predecessorSha256:prior,inputsSha256:${quote(pin.inputsSha256)}});prior=c.sha256;}const jobs=require('node:child_process').execFileSync(process.execPath,['/build/scripts/native-build-concurrency.mjs'],{encoding:'utf8',timeout:30000,maxBuffer:4096}).trim();assert.equal(jobs,'5');`;
  const post = `${common}${parser};${parseCurrent}console.log('NATIVE_NEXT_PHASE_CORE='+JSON.stringify({phase:${quote(phase)},planSha256:${quote(planSha256)},receiptSha256:sha(b),receiptBase64:b.toString('base64'),unitAcceptance:false,packageAcceptance:false,runtimeAcceptance:false}));`;
  const compile = `set -eu;node -e ${quote(pre)};sh /build/scripts/build-llvm-runtime.sh --phase ${phase} --predecessor-sha256 ${expectedParent.receiptSha256};node -e ${quote(post)}`;
  const parentManifest = `${common}const x=JSON.parse(bounded('native-next-proof/parent-manifest.json',2097152));assert.deepEqual(x.failures??[],[]);assert.equal(x.images.length,1);const i=x.images[0];assert.equal(i.imageId.imageDigest,${quote(expectedParent.imageDigest)});assert.equal('sha256:'+sha(i.imageManifest),${quote(expectedParent.imageDigest)});const m=JSON.parse(i.imageManifest);assert.equal(m.schemaVersion,2);assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');assert.equal(m.config.digest,${quote(expectedParent.imageConfigDigest)});assert.ok(m.layers.length>0&&m.layers.length<=100&&m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<16*1024**3);`;
  const parentInspect = `${common}const rows=JSON.parse(bounded('native-next-proof/parent-inspect.json',2097152));assert.equal(rows.length,1);const[i]=rows;assert.equal(i.Id,${quote(expectedParent.imageConfigDigest)});assert.ok(i.RepoDigests.includes(${quote(image)}));assert.equal(i.Config.Labels['vaettir.source-commit'],${quote(pin.commit)});assert.equal(i.Config.Labels['vaettir.continuation-plan'],${quote(expectedParent.planSha256)});assert.equal(i.Config.Labels['vaettir.runtime-eligible'],'false');assert.equal(i.Config.Labels['vaettir.artifact-purpose'],'llvm-builder-checkpoint');assert.ok(Number.isSafeInteger(i.Size)&&i.Size>0&&i.Size<64*1024**3);`;
  const absent = `${common}const x=JSON.parse(bounded('native-next-proof/tag-preflight.json',2097152));assert.deepEqual(x.images,[]);assert.equal(x.failures?.length,1);assert.equal(x.failures[0].failureCode,'ImageNotFound');assert.equal(x.failures[0].imageId.imageTag,${quote(tag)});`;
  const readId = `${common}const id=bounded('native-next-proof/container-id',65).toString('utf8').trim();assert.match(id,/^[a-f0-9]{64}$/);process.stdout.write(id);`;
  const readCommitId = `${common}const id=bounded('native-next-proof/commit-id.txt',72).toString('utf8').trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);process.stdout.write(id);`;
  function containerProgram(kind) {
    const verify = kind === "verifier", name = verify ? "verifier" : "compiler";
    const imageCheck = verify ? `const committed=bounded('native-next-proof/commit-id.txt',72).toString('utf8').trim();assert.match(committed,/^sha256:[a-f0-9]{64}$/);assert.equal(i.Image,committed);assert.equal(i.Config.Image,committed);` : `assert.equal(i.Image,${quote(expectedParent.imageConfigDigest)});assert.equal(i.Config.Image,${quote(image)});`;
    return `${common}const rows=JSON.parse(bounded('native-next-proof/${name}-inspect.json',2097152));assert.equal(rows.length,1);const[i]=rows;${imageCheck}assert.equal(i.Config.Labels['vaettir.continuation-owner'],${quote(planSha256)});assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(i.HostConfig.Privileged,false);assert.deepEqual(i.HostConfig.CapDrop,['ALL']);assert.ok(i.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(i.HostConfig.Memory,${verify ? 2 : 14}*1024**3);assert.equal(i.HostConfig.NanoCpus,${verify ? 2 : 8}e9);assert.equal(i.HostConfig.PidsLimit,${verify ? 128 : 2048});assert.deepEqual(i.Mounts,[]);`;
  }
  const compilerInspect = containerProgram("compiler"), verifierInspect = containerProgram("verifier");
  const collect = `${common}${parser};const rows=bounded('native-next-proof/compile.log',16777216).toString('utf8').split(RegExp(String.fromCharCode(13)+'?'+String.fromCharCode(10))).filter(l=>l.startsWith('NATIVE_NEXT_PHASE_CORE='));assert.equal(rows.length,1);const p=JSON.parse(rows[0].slice('NATIVE_NEXT_PHASE_CORE='.length));assert.deepEqual(Object.keys(p).sort(),['phase','planSha256','receiptSha256','receiptBase64','unitAcceptance','packageAcceptance','runtimeAcceptance'].sort());assert.equal(p.phase,${quote(phase)});assert.equal(p.planSha256,${quote(planSha256)});const b=bounded('native-next-proof/phase-receipt.json',32768);assert.equal(p.receiptBase64,b.toString('base64'));assert.equal(p.receiptSha256,sha(b));validateNativeCheckpointReceipt(b,{...${JSON.stringify(expected)},sha256:sha(b)});for(const k of ['unitAcceptance','packageAcceptance','runtimeAcceptance'])assert.equal(p[k],false);fs.writeFileSync('native-next-proof/phase-proof.json',JSON.stringify(p)+String.fromCharCode(10),{flag:'wx'});`;
  const successor = `${common}${parser};${parseCurrent}(async()=>{const {checkpointStore}=await import('/build/scripts/native-llvm-checkpoint.mjs');checkpointStore().begin(${quote(successorPhase)},sha(b));console.log('NATIVE_NEXT_PHASE_STATE='+JSON.stringify({phase:${quote(phase)},planSha256:${quote(planSha256)},receiptSha256:sha(b),actualStateVerified:true,runtimeAcceptance:false}))})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1});`;
  const candidateInspect = `${common}const committed=bounded('native-next-proof/commit-id.txt',72).toString('utf8').trim();assert.match(committed,/^sha256:[a-f0-9]{64}$/);const rows=JSON.parse(bounded('native-next-proof/candidate-inspect.json',2097152));assert.equal(rows.length,1);const[i]=rows;assert.equal(i.Id,committed);assert.equal(i.Config.Labels['vaettir.continuation-plan'],${quote(planSha256)});assert.equal(i.Config.Labels['vaettir.continuation-phase'],${quote(phase)});assert.equal(i.Config.Labels['vaettir.source-commit'],${quote(pin.commit)});assert.equal(i.Config.Labels['vaettir.runtime-eligible'],'false');assert.equal(i.Config.Labels['vaettir.artifact-purpose'],'llvm-builder-checkpoint');assert.ok(Number.isSafeInteger(i.Size)&&i.Size>0&&i.Size<64*1024**3);`;
  const readback = `${common}${parser};
const x=JSON.parse(bounded('native-next-proof/candidate-manifest.json',2097152));assert.deepEqual(x.failures??[],[]);assert.equal(x.images.length,1);
const i=x.images[0],d='sha256:'+sha(i.imageManifest);assert.equal(i.imageId.imageDigest,d);assert.equal(i.imageId.imageTag,${quote(tag)});
const m=JSON.parse(i.imageManifest);assert.equal(m.schemaVersion,2);assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');
assert.ok(m.layers.length>0&&m.layers.length<=100&&m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<16*1024**3);
const committed=bounded('native-next-proof/commit-id.txt',72).toString('utf8').trim();assert.match(committed,/^sha256:[a-f0-9]{64}$/);assert.equal(m.config.digest,committed);
const rows=JSON.parse(bounded('native-next-proof/candidate-inspect.json',2097152));assert.equal(rows.length,1);const[local]=rows;assert.equal(local.Id,committed);
assert.equal(local.Config.Labels['vaettir.continuation-plan'],${quote(planSha256)});assert.equal(local.Config.Labels['vaettir.continuation-phase'],${quote(phase)});assert.equal(local.Config.Labels['vaettir.source-commit'],${quote(pin.commit)});assert.equal(local.Config.Labels['vaettir.runtime-eligible'],'false');assert.equal(local.Config.Labels['vaettir.artifact-purpose'],'llvm-builder-checkpoint');assert.ok(Number.isSafeInteger(local.Size)&&local.Size>0&&local.Size<64*1024**3);
const pushes=[...bounded('native-next-proof/push.log',1048576).toString('utf8').matchAll(/digest: (sha256:[a-f0-9]{64})/g)];assert.equal(pushes.length,1);assert.equal(pushes[0][1],d);
const states=bounded('native-next-proof/state.log',1048576).toString('utf8').split(RegExp(String.fromCharCode(13)+'?'+String.fromCharCode(10))).filter(l=>l.startsWith('NATIVE_NEXT_PHASE_STATE='));assert.equal(states.length,1);
const s=JSON.parse(states[0].slice('NATIVE_NEXT_PHASE_STATE='.length)),p=JSON.parse(bounded('native-next-proof/phase-proof.json',65536));
assert.deepEqual(Object.keys(p).sort(),['phase','planSha256','receiptSha256','receiptBase64','unitAcceptance','packageAcceptance','runtimeAcceptance'].sort());assert.deepEqual(Object.keys(s).sort(),['phase','planSha256','receiptSha256','actualStateVerified','runtimeAcceptance'].sort());
assert.equal(p.phase,${quote(phase)});assert.equal(s.phase,${quote(phase)});assert.equal(p.planSha256,${quote(planSha256)});assert.equal(s.planSha256,${quote(planSha256)});
const b=bounded('native-next-proof/phase-receipt.json',32768);assert.equal(p.receiptBase64,b.toString('base64'));assert.equal(p.receiptSha256,sha(b));validateNativeCheckpointReceipt(b,{...${JSON.stringify(expected)},sha256:sha(b)});
assert.equal(s.receiptSha256,p.receiptSha256);assert.equal(s.actualStateVerified,true);assert.equal(s.runtimeAcceptance,false);for(const k of ['unitAcceptance','packageAcceptance','runtimeAcceptance'])assert.equal(p[k],false);
console.log('NATIVE_NEXT_PHASE_VERIFIED='+JSON.stringify({...p,sourceCommit:${quote(pin.commit)},sourceSha256:${quote(pin.sourceSha256)},predecessorImageDigest:${quote(expectedParent.imageDigest)},predecessorReceiptSha256:${quote(expectedParent.receiptSha256)},imageDigest:d,imageConfigDigest:committed,actualStateVerified:true,authenticatedAcceptance:false,deploymentAcceptance:false}));`;
  const commands = [
    "trap 'exit 124' TERM", 'test "$CODEBUILD_BUILD_SUCCEEDING" = 1', 'timeout 20s docker info >/dev/null', 'mkdir native-next-proof',
    `available_bytes=$(df -PB1 /var/lib/docker | tail -1 | awk '{print $4}');case "$available_bytes" in *[!0-9]*|'') exit 1;;esac;test "$available_bytes" -ge 77309411328`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageDigest=${expectedParent.imageDigest} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json >native-next-proof/parent-manifest.json`, `timeout 20s node -e ${quote(parentManifest)}`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${tag} --region us-east-2 --output json >native-next-proof/tag-preflight.json`, `timeout 20s node -e ${quote(absent)}`,
    `timeout 60s aws ecr get-login-password --region us-east-2 | timeout 60s docker login --username AWS --password-stdin ${registry}`,
    `timeout --signal=TERM --kill-after=20s 300s docker pull ${image}`, `timeout 20s docker image inspect ${image} >native-next-proof/parent-inspect.json`, `timeout 20s node -e ${quote(parentInspect)}`,
    'native_create_status=0', `timeout 30s docker create --cidfile native-next-proof/container-id --label vaettir.continuation-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --entrypoint sh ${image} -eu -c ${quote(compile)} >native-next-proof/create-output.txt || native_create_status=$?`,
    `native_validation_container=$(timeout 20s node -e ${quote(readId)})`, 'test "$native_create_status" = 0', 'timeout 20s docker inspect "$native_validation_container" >native-next-proof/compiler-inspect.json', `timeout 20s node -e ${quote(compilerInspect)}`,
    `timeout --signal=TERM --kill-after=20s ${resources.compileSeconds}s docker start -a "$native_validation_container" | tee native-next-proof/compile.log`, 'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_validation_container")" = 0', `timeout 30s docker cp "$native_validation_container:/build/llvm-phase-receipts/${phase}.json" native-next-proof/phase-receipt.json`, `timeout 20s node -e ${quote(collect)}`,
    `timeout 180s docker commit --change ${quote(`LABEL vaettir.continuation-plan=${planSha256}`)} --change ${quote(`LABEL vaettir.continuation-phase=${phase}`)} "$native_validation_container" ${candidate} >native-next-proof/commit-id.txt`, 'cleanup_native_validation', "native_validation_container=''", 'rm -- native-next-proof/container-id',
    `native_candidate_image=$(timeout 20s node -e ${quote(readCommitId)})`, 'native_create_status=0', `timeout 30s docker create --cidfile native-next-proof/container-id --label vaettir.continuation-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 2g --cpus 2 --entrypoint node "$native_candidate_image" -e ${quote(successor)} >native-next-proof/verify-create-output.txt || native_create_status=$?`,
    `native_validation_container=$(timeout 20s node -e ${quote(readId)})`, 'test "$native_create_status" = 0', 'timeout 20s docker inspect "$native_validation_container" >native-next-proof/verifier-inspect.json', `timeout 20s node -e ${quote(verifierInspect)}`,
    'timeout --signal=TERM --kill-after=20s 240s docker start -a "$native_validation_container" | tee native-next-proof/state.log', 'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_validation_container")" = 0', 'cleanup_native_validation', "native_validation_container=''",
    `timeout 20s docker image inspect ${candidate} >native-next-proof/candidate-inspect.json`, `timeout 20s node -e ${quote(candidateInspect)}`, `timeout --signal=TERM --kill-after=20s 180s docker push ${candidate} | tee native-next-proof/push.log`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${tag} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json >native-next-proof/candidate-manifest.json`, `timeout 20s node -e ${quote(readback)}`,
  ];
  const operation = `timeout --signal=TERM --kill-after=30s ${resources.totalSeconds}s ${nativeValidationShell(commands)}`;
  assert.doesNotMatch(operation, /describe-images|put-object|update-project|put-role-policy|ecs |rds |migrate|:latest|--phase final /);
  const transport = packNativeContinuationOperation(operation);
  const decoder = `const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{gunzipSync}=require('node:zlib'),{spawnSync}=require('node:child_process');${unpackNativeContinuationOperation.toString()};const operation=unpackNativeContinuationOperation(${JSON.stringify(transport)});const r=spawnSync('/bin/bash',['-eu','-o','pipefail','-c',operation],{stdio:'inherit',timeout:${(resources.totalSeconds + 60) * 1000},killSignal:'SIGTERM'});if(r.error)throw r.error;assert.equal(r.signal,null);assert.equal(r.status,0);`;
  const spec = { version: "0.2", phases: { build: { commands: [`node -e ${quote(decoder)}`] }, post_build: { commands: ['test "$CODEBUILD_BUILD_SUCCEEDING" = 1', 'echo "INCOMPLETE NATIVE BUILDER: complete final release/assertion suites, package, runtime, image security and deployment remain unaccepted."'] } } };
  const request = { projectName: "vaettir-api-build", sourceTypeOverride: "S3", sourceLocationOverride: `vaettir-build-source-051722405355/releases/${pin.commit}/source.zip`, buildspecOverride: JSON.stringify(spec), timeoutInMinutesOverride: 45, computeTypeOverride: "BUILD_GENERAL1_LARGE", environmentVariablesOverride: [{ name: "VAETTIR_RELEASE_COMMIT", value: pin.commit, type: "PLAINTEXT" }], idempotencyToken: `native-${phase}-${planSha256.slice(0, 32)}` };
  assert.ok(request.buildspecOverride.length <= 25600 && Buffer.byteLength(request.buildspecOverride) <= 25600);
  return { ...identity, planSha256, request, requestSha256: hash(JSON.stringify(request)), transport, operation, generatedPrograms: { pre, post, parentManifest, parentInspect, absent, readId, readCommitId, compilerInspect, verifierInspect, collect, successor, candidateInspect, readback, decoder }, importedImage: image, candidateTag: tag, unitAcceptance: false, packageAcceptance: false, runtimeAcceptance: false, authenticatedAcceptance: false, deploymentAcceptance: false, defaultRuntimeGraphChanged: false, dispatchRequiresRootPreflight: true, forecastAcceptance: resources.mode === "measured", finalSupported: false };
}
