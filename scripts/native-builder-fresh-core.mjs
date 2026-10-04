// Pure local fresh prepare->core planning. No Git/cloud/Docker/credentials are
// invoked here. Root retains actual build/log/registry fingerprints and owns
// admission, immutable intent and exactly one dispatch. Probes may fail the
// global deadline; no borrowed timing promises or partial runtime acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { nativeValidationShell } from "./native-builder-recovery.mjs";
import { validateNativeCheckpointReceipt } from "./native-builder-continuation.mjs";
import {
  validateNativeFreshPrepareCompleted,
  unpackFreshPrepareOperation,
} from "./native-builder-fresh-prepare.mjs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const hex = /^[a-f0-9]{64}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const repository = "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api";
const flags = [
  "unitAcceptance",
  "packageAcceptance",
  "runtimeAcceptance",
  "authenticatedAcceptance",
  "deploymentAcceptance",
];
const exact = (value, names) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...names].sort());
};
// Hash-bound public ABI metadata, not a substitute for observed checker work.
function validateCoreAbiBytes(bytes, expected) {
  assert.ok(
    Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 32768,
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    expected.sha256,
  );
  let abi;
  try {
    abi = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Unsupported ABI receipt encoding or JSON");
  }
  assert.equal(abi.soname, "libLLVM.so.19.1");
  assert.equal(abi.runtimeAccepted, false);
  assert.equal(abi.baselineSha256, expected.baselineSha256);
  assert.equal(abi.candidateSha256, expected.candidateSha256);
  for (const key of ["baselineExports", "candidateExports"])
    assert.ok(
      Number.isSafeInteger(abi[key]) && abi[key] > 0 && abi[key] <= 1000000,
    );
  assert.ok(abi.candidateExports >= abi.baselineExports);
  return abi;
}
function coreBudget(budget) {
  exact(budget, [
    "mode",
    "compileSeconds",
    "postCompileReserveSeconds",
    "totalSeconds",
  ]);
  assert.equal(
    budget.mode,
    "bounded-probe",
    "No unmeasured duration forecast allowed",
  );
  for (const key of [
    "compileSeconds",
    "postCompileReserveSeconds",
    "totalSeconds",
  ])
    assert.ok(Number.isSafeInteger(budget[key]));
  assert.ok(budget.compileSeconds >= 60 && budget.compileSeconds <= 2100);
  assert.ok(
    budget.postCompileReserveSeconds >= 120 &&
      budget.postCompileReserveSeconds <= 300,
  );
  assert.ok(
    budget.totalSeconds <= 2520 &&
      budget.totalSeconds >=
        budget.compileSeconds + budget.postCompileReserveSeconds + 60 + 75,
    "Compiler, post-work and cleanup admission cannot fit",
  );
  return {
    ...budget,
    operationSeconds: budget.totalSeconds - 75,
    cleanupGraceSeconds: 75,
    decoderWatchdogSeconds: budget.totalSeconds + 30,
    cpus: 8,
    memoryBytes: 14 * 1024 ** 3,
    compilerJobs: 5,
    minimumDiskAvailableBytes: 72 * 1024 ** 3,
    forecastAcceptance: false,
  };
}
function pack(operation) {
  const bytes = Buffer.from(operation, "utf8");
  assert.ok(bytes.length > 0 && bytes.length <= 512 * 1024);
  const compressed = gzipSync(bytes, { level: 9 });
  assert.ok(compressed.length <= 128 * 1024);
  const value = {
    encoding: "gzip-base64-sha256-v1",
    decodedSha256: hash(bytes),
    decodedBytes: bytes.length,
    compressedSha256: hash(compressed),
    compressedBytes: compressed.length,
    base64: compressed.toString("base64"),
  };
  assert.equal(unpackFreshPrepareOperation(value), operation);
  return value;
}

/** The source auto-extracted by CodeBuild is deliberately never executed,
 * built or imported. The only native source is the digest-pulled parent whose
 * complete fresh source/archive/script/config receipt was externally verified. */
export function planNativeFreshCore(input) {
  exact(input, [
    "completedPrepare",
    "expectedPrepare",
    "preparePlan",
    "budget",
  ]);
  const verified = validateNativeFreshPrepareCompleted(
    input.completedPrepare,
    input.expectedPrepare,
    input.preparePlan,
  );
  const resources = coreBudget(input.budget);
  const semantics = hash(
    [
      planNativeFreshCore,
      assemble,
      coreBudget,
      pack,
      validateNativeFreshCoreCompleted,
      validateCoreAbiBytes,
      validateNativeFreshPrepareCompleted,
      validateNativeCheckpointReceipt,
      unpackFreshPrepareOperation,
      nativeValidationShell,
      hash,
      quote,
      exact,
    ]
      .map((fn) => fn.toString())
      .join("\n") + JSON.stringify({ repository, flags }),
  );
  const identity = {
    schemaVersion: 1,
    purpose: "fresh-native-core-not-runtime",
    phase: "release-core",
    plannerSemanticsSha256: semantics,
    sourceCommit: verified.sourceCommit,
    sourceSha256: verified.sourceSha256,
    preparePlanSha256: input.preparePlan.planSha256,
    prepareExpected: { ...input.expectedPrepare },
    prepareReceiptBase64: input.completedPrepare.proof.receiptBase64,
    inputsSha256: verified.inputsSha256,
    sourceManifestSha256: input.completedPrepare.proof.sourceManifestSha256,
    expectedScripts: { ...input.preparePlan.identity.expectedScripts },
    resources,
  };
  return assemble(identity);
}
function assemble(identity) {
  const planSha256 = hash(JSON.stringify(identity)),
    tag = "native-fresh-core-" + planSha256.slice(0, 40),
    candidate = repository + ":" + tag,
    parent = repository + "@" + identity.prepareExpected.imageDigest,
    prefix = "native-fresh-core-proof/";
  const parentHash = identity.prepareExpected.receiptSha256,
    parentConfig = identity.prepareExpected.imageConfigDigest;
  const common = `const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');const sha=b=>createHash('sha256').update(b).digest('hex');const bounded=(p,n)=>{const s=fs.lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=n);const b=fs.readFileSync(p);assert.equal(b.length,s.size);return b};`;
  const parse =
    validateNativeCheckpointReceipt.toString() +
    ";" +
    validateCoreAbiBytes.toString();
  const disk = `const fs=require('node:fs'),assert=require('node:assert/strict');const s=fs.statfsSync('/var/lib/docker',{bigint:true});assert.ok(s.bavail*s.bsize>=${identity.resources.minimumDiskAvailableBytes}n,'Native compiler storage admission failed');`;
  const absent = `${common}const x=JSON.parse(bounded('${prefix}tag-preflight.json',2097152));assert.deepEqual(x.images??[],[]);assert.equal(x.failures?.length,1);assert.equal(x.failures[0].failureCode,'ImageNotFound');assert.equal(x.failures[0].imageId.imageTag,'${tag}');`;
  const parentManifest = `${common}const x=JSON.parse(bounded('${prefix}parent-manifest.json',2097152));assert.deepEqual(x.failures??[],[]);assert.equal(x.images.length,1);const i=x.images[0];assert.equal(i.imageId.imageDigest,'${identity.prepareExpected.imageDigest}');assert.equal('sha256:'+sha(i.imageManifest),'${identity.prepareExpected.imageDigest}');const m=JSON.parse(i.imageManifest);assert.equal(m.schemaVersion,2);assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');assert.equal(m.config.digest,'${parentConfig}');assert.ok(m.layers.length>0&&m.layers.length<=100&&m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<16*1024**3);`;
  const parentInspect = `${common}const x=JSON.parse(bounded('${prefix}parent-inspect.json',2097152));assert.equal(x.length,1);const[i]=x;assert.equal(i.Id,'${parentConfig}');assert.equal(i.Os,'linux');assert.equal(i.Architecture,'amd64');assert.ok(i.RepoDigests.includes('${parent}'));assert.ok(Number.isSafeInteger(i.Size)&&i.Size>0&&i.Size<64*1024**3);const l=i.Config.Labels;assert.equal(l['vaettir.source-commit'],'${identity.sourceCommit}');assert.equal(l['vaettir.source-sha256'],'${identity.sourceSha256}');assert.equal(l['vaettir.prepare-plan'],'${identity.preparePlanSha256}');assert.equal(l['vaettir.runtime-eligible'],'false');assert.equal(l['vaettir.artifact-purpose'],'llvm-builder-checkpoint');`;
  const start = `${common}assert.equal(process.env.VAETTIR_RELEASE_COMMIT,'${identity.sourceCommit}');const startedNs=process.hrtime.bigint().toString();fs.writeFileSync('${prefix}admission.json',JSON.stringify({planSha256:'${planSha256}',startedNs})+String.fromCharCode(10),{flag:'wx'});`;
  const admit = `${common}const x=JSON.parse(bounded('${prefix}admission.json',512));assert.equal(x.planSha256,'${planSha256}');assert.match(x.startedNs,/^[0-9]{1,30}$/);const elapsed=process.hrtime.bigint()-BigInt(x.startedNs);assert.ok(elapsed>=0n);const remaining=${identity.resources.operationSeconds}-Number(elapsed/1000000000n);assert.ok(remaining>=${identity.resources.compileSeconds + identity.resources.postCompileReserveSeconds},'Remaining observed deadline cannot admit complete core probe and post-work');`;
  const readId = `${common}const p='${prefix}container-id';if(!fs.existsSync(p)){process.stdout.write('')}else{const id=bounded(p,64).toString('utf8');assert.match(id,/^[a-f0-9]{64}$/);process.stdout.write(id);}`;
  const readCommitId = `${common}const id=bounded('${prefix}commit-id.txt',80).toString('utf8').trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);process.stdout.write(id);`;
  const cleanupOwner = `${common}const x=JSON.parse(bounded('${prefix}cleanup-inspect.json',2097152));assert.equal(x.length,1);const[i]=x;assert.equal(i.Id,bounded('${prefix}container-id',64).toString('utf8'));assert.equal(i.Image,bounded('${prefix}cleanup-image-id',72).toString('utf8'));assert.equal(i.Config.Labels['vaettir.core-owner'],'${planSha256}');assert.deepEqual(i.Mounts,[]);`;
  const compilerInspect = `${common}const x=JSON.parse(bounded('${prefix}compiler-inspect.json',2097152));assert.equal(x.length,1);const[i]=x;assert.equal(i.Id,bounded('${prefix}container-id',64).toString('utf8'));assert.equal(i.Image,'${parentConfig}');assert.equal(i.Config.Image,'${parent}');assert.equal(i.Config.Labels['vaettir.core-owner'],'${planSha256}');assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(i.HostConfig.Privileged,false);assert.deepEqual(i.HostConfig.CapDrop,['ALL']);assert.ok(i.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(i.HostConfig.Memory,15032385536);assert.equal(i.HostConfig.NanoCpus,8000000000);assert.equal(i.HostConfig.PidsLimit,2048);assert.deepEqual(i.Mounts,[]);`;
  const setParentCleanup = `${common}fs.writeFileSync('${prefix}cleanup-image-id','${parentConfig}',{flag:'wx'});`;
  const setCandidateCleanup = `${common}const id=bounded('${prefix}commit-id.txt',80).toString('utf8').trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);fs.writeFileSync('${prefix}cleanup-image-id',id,{flag:'wx'});`;
  const verifierInspect = `${common}const x=JSON.parse(bounded('${prefix}verifier-inspect.json',2097152));assert.equal(x.length,1);const[i]=x,id=bounded('${prefix}commit-id.txt',80).toString('utf8').trim();assert.equal(i.Id,bounded('${prefix}container-id',64).toString('utf8'));assert.equal(i.Image,id);assert.equal(i.Config.Image,id);assert.equal(i.Config.Labels['vaettir.core-owner'],'${planSha256}');assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(i.HostConfig.Privileged,false);assert.deepEqual(i.HostConfig.CapDrop,['ALL']);assert.ok(i.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(i.HostConfig.Memory,2147483648);assert.equal(i.HostConfig.NanoCpus,2000000000);assert.equal(i.HostConfig.PidsLimit,128);assert.deepEqual(i.Mounts,[]);`;
  const pre = `${common}${parse};const pins=${JSON.stringify(identity.expectedScripts)};assert.deepEqual(fs.readdirSync('/build/scripts').sort(),Object.keys(pins).sort());for(const[n,h]of Object.entries(pins))assert.equal(sha(bounded('/build/scripts/'+n,1048576)),h);assert.ok(!fs.existsSync('/build/llvm-phase-active.json'));assert.deepEqual(fs.readdirSync('/build/llvm-phase-receipts'),['prepare.json']);const b=bounded('/build/llvm-phase-receipts/prepare.json',32768);validateNativeCheckpointReceipt(b,{phase:'prepare',sha256:'${parentHash}',predecessorSha256:null,inputsSha256:'${identity.inputsSha256}'});assert.equal(sha(bounded('/build/llvm-sources/source-manifest.json',65536)),'${identity.sourceManifestSha256}');const jobs=require('node:child_process').execFileSync(process.execPath,['/build/scripts/native-build-concurrency.mjs'],{encoding:'utf8',timeout:30000,maxBuffer:4096}).trim();assert.equal(jobs,'5');`;
  const candidateBody = `${common}${parse};async function verifyFreshCoreCandidate(hashCandidateLibrary){const b=bounded('/build/llvm-phase-receipts/release-core.json',32768),r=validateNativeCheckpointReceipt(b,{phase:'release-core',sha256:sha(b),predecessorSha256:'${parentHash}',inputsSha256:'${identity.inputsSha256}'});assert.ok(!fs.existsSync('/build/llvm-phase-active.json'));assert.deepEqual(fs.readdirSync('/build/llvm-phase-receipts').sort(),['prepare.json','release-core.json']);assert.equal(sha(bounded('/build/llvm-phase-receipts/prepare.json',32768)),'${parentHash}');const pins=${JSON.stringify(identity.expectedScripts)};assert.deepEqual(fs.readdirSync('/build/scripts').sort(),Object.keys(pins).sort());for(const[n,h]of Object.entries(pins))assert.equal(sha(bounded('/build/scripts/'+n,1048576)),h);const bytes=bounded('/build/llvm-early-abi.json',32768),abi=JSON.parse(bytes);assert.equal(sha(bytes),r.proof.abiReceiptSha256);assert.equal(abi.soname,'libLLVM.so.19.1');assert.equal(abi.runtimeAccepted,false);assert.equal(abi.baselineSha256,r.inputs.baselineSha256);const candidate=hashCandidateLibrary('/build','release-core');assert.equal(candidate.sha256,abi.candidateSha256);validateCoreAbiBytes(bytes,{sha256:r.proof.abiReceiptSha256,baselineSha256:r.inputs.baselineSha256,candidateSha256:candidate.sha256});assert.ok(Number.isSafeInteger(candidate.bytes)&&candidate.bytes>0&&candidate.bytes<=4*1024**3);return {schemaVersion:1,purpose:'fresh-native-core-phase-evidence',planSha256:'${planSha256}',sourceCommit:'${identity.sourceCommit}',sourceSha256:'${identity.sourceSha256}',predecessorImageDigest:'${identity.prepareExpected.imageDigest}',predecessorReceiptSha256:'${parentHash}',receiptSha256:sha(b),receiptBase64:b.toString('base64'),inputsSha256:r.inputsSha256,candidateSha256:candidate.sha256,abiReceiptSha256:r.proof.abiReceiptSha256,abiReceiptBase64:bytes.toString('base64'),unitAcceptance:false,packageAcceptance:false,runtimeAcceptance:false,authenticatedAcceptance:false,deploymentAcceptance:false};}`;
  const post = `${candidateBody};(async()=>{const{hashCandidateLibrary}=await import('/build/scripts/native-llvm-checkpoint.mjs');console.log('NATIVE_FRESH_CORE_PHASE='+JSON.stringify(await verifyFreshCoreCandidate(hashCandidateLibrary)))})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1});`;
  const successorBody = `${candidateBody};async function verifyFreshCoreSuccessor(checkpointStore,hashCandidateLibrary){const p=await verifyFreshCoreCandidate(hashCandidateLibrary);checkpointStore().begin('release-units',p.receiptSha256);console.log('NATIVE_FRESH_CORE_STATE='+JSON.stringify({planSha256:'${planSha256}',receiptSha256:p.receiptSha256,candidateSha256:p.candidateSha256,abiReceiptSha256:p.abiReceiptSha256,actualStateVerified:true,runtimeAcceptance:false}));return p;}`;
  const successor = `${successorBody};(async()=>{const{checkpointStore,hashCandidateLibrary}=await import('/build/scripts/native-llvm-checkpoint.mjs');await verifyFreshCoreSuccessor(checkpointStore,hashCandidateLibrary)})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1});`;
  const compile = `set -eu; node -e ${quote(pre)}; sh /build/scripts/build-llvm-runtime.sh --phase release-core --predecessor-sha256 ${parentHash}; node -e ${quote(post)}`;
  const collect = String.raw`${common}${parse};const lines=bounded('${prefix}compile.log',16777216).toString('utf8').split(/\r?\n/).filter(l=>l.startsWith('NATIVE_FRESH_CORE_PHASE='));assert.equal(lines.length,1);const p=JSON.parse(lines[0].slice('NATIVE_FRESH_CORE_PHASE='.length));assert.equal(p.planSha256,'${planSha256}');const b=bounded('${prefix}release-core.json',32768);assert.equal(p.receiptBase64,b.toString('base64'));assert.equal(p.receiptSha256,sha(b));const r=validateNativeCheckpointReceipt(b,{phase:'release-core',sha256:p.receiptSha256,predecessorSha256:'${parentHash}',inputsSha256:'${identity.inputsSha256}'});const abiBytes=Buffer.from(p.abiReceiptBase64,'base64');assert.equal(abiBytes.toString('base64'),p.abiReceiptBase64);validateCoreAbiBytes(abiBytes,{sha256:r.proof.abiReceiptSha256,baselineSha256:r.inputs.baselineSha256,candidateSha256:p.candidateSha256});assert.equal(p.abiReceiptSha256,r.proof.abiReceiptSha256);for(const k of ${JSON.stringify(flags)})assert.equal(p[k],false);fs.writeFileSync('${prefix}core-proof.json',JSON.stringify(p)+'\n',{flag:'wx'});`;
  const candidateInspect = `${common}const x=JSON.parse(bounded('${prefix}candidate-inspect.json',2097152));assert.equal(x.length,1);const[i]=x,id=bounded('${prefix}commit-id.txt',80).toString('utf8').trim();assert.equal(i.Id,id);assert.equal(i.Os,'linux');assert.equal(i.Architecture,'amd64');assert.ok(Number.isSafeInteger(i.Size)&&i.Size>0&&i.Size<64*1024**3);const l=i.Config.Labels;assert.equal(l['vaettir.continuation-plan'],'${planSha256}');assert.equal(l['vaettir.source-commit'],'${identity.sourceCommit}');assert.equal(l['vaettir.source-sha256'],'${identity.sourceSha256}');assert.equal(l['vaettir.prepare-plan'],'${identity.preparePlanSha256}');assert.equal(l['vaettir.runtime-eligible'],'false');assert.equal(l['vaettir.artifact-purpose'],'llvm-builder-checkpoint');`;
  const readback = String.raw`${common}${parse};const x=JSON.parse(bounded('${prefix}candidate-manifest.json',2097152));assert.deepEqual(x.failures??[],[]);assert.equal(x.images.length,1);const i=x.images[0],d='sha256:'+sha(i.imageManifest);assert.equal(i.imageId.imageDigest,d);assert.equal(i.imageId.imageTag,'${tag}');assert.notEqual(d,'${identity.prepareExpected.imageDigest}');const m=JSON.parse(i.imageManifest),[local]=JSON.parse(bounded('${prefix}candidate-inspect.json',2097152));assert.equal(m.schemaVersion,2);assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');assert.equal(m.config.digest,local.Id);assert.equal(local.Id,bounded('${prefix}commit-id.txt',80).toString('utf8').trim());assert.ok(m.layers.length>0&&m.layers.length<=100&&m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<16*1024**3);const matches=bounded('${prefix}push.log',1048576).toString('utf8').split(/\r?\n/).map(l=>/digest: (sha256:[a-f0-9]{64})(?:\s|$)/.exec(l)).filter(Boolean);assert.equal(matches.length,1);assert.equal(matches[0][1],d);const states=bounded('${prefix}state.log',131072).toString('utf8').split(/\r?\n/).filter(l=>l.startsWith('NATIVE_FRESH_CORE_STATE='));assert.equal(states.length,1);const state=JSON.parse(states[0].slice('NATIVE_FRESH_CORE_STATE='.length)),p=JSON.parse(bounded('${prefix}core-proof.json',65536)),b=bounded('${prefix}release-core.json',32768);assert.equal(state.planSha256,'${planSha256}');assert.equal(p.planSha256,'${planSha256}');assert.equal(state.receiptSha256,p.receiptSha256);assert.equal(state.candidateSha256,p.candidateSha256);assert.equal(state.abiReceiptSha256,p.abiReceiptSha256);assert.equal(p.receiptSha256,sha(b));assert.equal(p.receiptBase64,b.toString('base64'));assert.equal(state.actualStateVerified,true);assert.equal(state.runtimeAcceptance,false);const r=validateNativeCheckpointReceipt(b,{phase:'release-core',sha256:p.receiptSha256,predecessorSha256:'${parentHash}',inputsSha256:'${identity.inputsSha256}'});const abiBytes=Buffer.from(p.abiReceiptBase64,'base64');assert.equal(abiBytes.toString('base64'),p.abiReceiptBase64);validateCoreAbiBytes(abiBytes,{sha256:r.proof.abiReceiptSha256,baselineSha256:r.inputs.baselineSha256,candidateSha256:p.candidateSha256});assert.equal(p.abiReceiptSha256,r.proof.abiReceiptSha256);for(const k of ${JSON.stringify(flags)})assert.equal(p[k],false);console.log('NATIVE_FRESH_CORE_VERIFIED='+JSON.stringify({...p,imageDigest:d,imageConfigDigest:local.Id,imageSizeBytes:local.Size,actualStateVerified:true,prePushInspection:true,digestPullEvidence:false}));`;
  const commands = [
    "trap 'exit 124' TERM",
    'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
    `mkdir ${prefix.slice(0, -1)}`,
    `timeout 20s node -e ${quote(start)}`,
    `cleanup_native_validation() { case "$native_validation_container" in '') return 0 ;; *[!0-9a-f]*) return 70 ;; esac; test "\${#native_validation_container}" = 64 || return 70; timeout 20s docker inspect "$native_validation_container" >${prefix}cleanup-inspect.json || return 70; timeout 20s node -e ${quote(cleanupOwner)} || return 70; timeout 20s docker rm -f "$native_validation_container" >/dev/null; }`,
    "timeout 20s docker info >/dev/null",
    `timeout 20s node -e ${quote(disk)}`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageDigest=${identity.prepareExpected.imageDigest} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json >${prefix}parent-manifest.json`,
    `timeout 20s node -e ${quote(parentManifest)}`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${tag} --region us-east-2 --output json >${prefix}tag-preflight.json`,
    `timeout 20s node -e ${quote(absent)}`,
    `timeout 60s aws ecr get-login-password --region us-east-2 | timeout 60s docker login --username AWS --password-stdin 051722405355.dkr.ecr.us-east-2.amazonaws.com`,
    `timeout --signal=TERM --kill-after=20s 300s docker pull ${parent}`,
    `timeout 20s docker image inspect ${parent} >${prefix}parent-inspect.json`,
    `timeout 20s node -e ${quote(parentInspect)}`,
    `timeout 20s node -e ${quote(setParentCleanup)}`,
    "native_create_status=0",
    `timeout 30s docker create --cidfile ${prefix}container-id --label vaettir.core-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --entrypoint sh ${parent} -eu -c ${quote(compile)} >${prefix}create-output.txt || native_create_status=$?`,
    `native_validation_container=$(timeout 20s node -e ${quote(readId)})`,
    'test "$native_create_status" = 0',
    'test -n "$native_validation_container"',
    `timeout 20s docker inspect "$native_validation_container" >${prefix}compiler-inspect.json`,
    `timeout 20s node -e ${quote(compilerInspect)}`,
    `timeout 20s node -e ${quote(admit)}`,
    `timeout --signal=TERM --kill-after=20s ${identity.resources.compileSeconds}s docker start -a "$native_validation_container" | tee ${prefix}compile.log`,
    'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_validation_container")" = 0',
    `timeout 30s docker cp "$native_validation_container:/build/llvm-phase-receipts/release-core.json" ${prefix}release-core.json`,
    `timeout 20s node -e ${quote(collect)}`,
    `timeout 180s docker commit --change ${quote("LABEL vaettir.continuation-plan=" + planSha256)} "$native_validation_container" ${candidate} >${prefix}commit-id.txt`,
    "cleanup_native_validation",
    "native_validation_container=''",
    `rm -- ${prefix}container-id ${prefix}cleanup-image-id`,
    `native_candidate_image=$(timeout 20s node -e ${quote(readCommitId)})`,
    `timeout 20s node -e ${quote(setCandidateCleanup)}`,
    "native_create_status=0",
    `timeout 30s docker create --cidfile ${prefix}container-id --label vaettir.core-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 2g --cpus 2 --entrypoint node "$native_candidate_image" -e ${quote(successor)} >${prefix}verify-create-output.txt || native_create_status=$?`,
    `native_validation_container=$(timeout 20s node -e ${quote(readId)})`,
    'test "$native_create_status" = 0',
    'test -n "$native_validation_container"',
    `timeout 20s docker inspect "$native_validation_container" >${prefix}verifier-inspect.json`,
    `timeout 20s node -e ${quote(verifierInspect)}`,
    `timeout --signal=TERM --kill-after=20s 240s docker start -a "$native_validation_container" | tee ${prefix}state.log`,
    'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_validation_container")" = 0',
    "cleanup_native_validation",
    "native_validation_container=''",
    `timeout 20s docker image inspect ${candidate} >${prefix}candidate-inspect.json`,
    `timeout 20s node -e ${quote(candidateInspect)}`,
    `timeout --signal=TERM --kill-after=20s 180s docker push ${candidate} | tee ${prefix}push.log`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${tag} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json >${prefix}candidate-manifest.json`,
    `timeout 20s node -e ${quote(readback)}`,
  ];
  const operation = `timeout --signal=TERM --kill-after=75s ${identity.resources.operationSeconds}s ${nativeValidationShell(commands)}`;
  assert.doesNotMatch(
    operation,
    /describe-images|put-object|put-role-policy|update-project|--profile|ecs |rds |migrate|:latest|check-llvm-unit|docker build|aws s3api|unzip/,
  );
  const transport = pack(operation);
  const decoder = `const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{gunzipSync}=require('node:zlib'),{spawnSync}=require('node:child_process');${unpackFreshPrepareOperation.toString()};const operation=unpackFreshPrepareOperation(${JSON.stringify(transport)});const r=spawnSync('/bin/bash',['-eu','-o','pipefail','-c',operation],{stdio:'inherit',timeout:${identity.resources.decoderWatchdogSeconds * 1000},killSignal:'SIGTERM'});if(r.error)throw r.error;assert.equal(r.signal,null);assert.equal(r.status,0,'Fresh native core probe failed');`;
  const specification = {
    version: "0.2",
    phases: {
      build: { commands: [`node -e ${quote(decoder)}`] },
      post_build: {
        commands: [
          'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
          'echo "FRESH CORE BUILDER ONLY: complete units/package/runtime/security/deployment remain unaccepted."',
        ],
      },
    },
  };
  const request = {
    projectName: "vaettir-api-build",
    sourceTypeOverride: "S3",
    sourceLocationOverride: `vaettir-build-source-051722405355/releases/${identity.sourceCommit}/source.zip`,
    buildspecOverride: JSON.stringify(specification),
    timeoutInMinutesOverride: 45,
    computeTypeOverride: "BUILD_GENERAL1_LARGE",
    environmentVariablesOverride: [
      {
        name: "VAETTIR_RELEASE_COMMIT",
        value: identity.sourceCommit,
        type: "PLAINTEXT",
      },
    ],
    idempotencyToken: "native-fresh-core-" + planSha256.slice(0, 40),
    autoRetryLimitOverride: 0,
  };
  assert.ok(
    request.buildspecOverride.length <= 25600 &&
      Buffer.byteLength(request.buildspecOverride) <= 25600,
  );
  return {
    identity,
    planSha256,
    request,
    requestSha256: hash(JSON.stringify(request)),
    buildspecSha256: hash(request.buildspecOverride),
    candidateTag: tag,
    candidateImage: candidate,
    importedImage: parent,
    operation,
    transport,
    generatedPrograms: {
      disk,
      absent,
      parentManifest,
      parentInspect,
      start,
      admit,
      readId,
      readCommitId,
      cleanupOwner,
      compilerInspect,
      setParentCleanup,
      setCandidateCleanup,
      verifierInspect,
      pre,
      candidateBody,
      post,
      successorBody,
      successor,
      collect,
      candidateInspect,
      readback,
      decoder,
    },
    compileAcceptance: false,
    unitAcceptance: false,
    packageAcceptance: false,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
    deploymentAcceptance: false,
    defaultRuntimeGraphChanged: false,
    forecastAcceptance: false,
    dispatchRequiresRootPreflight: true,
    globalDeadlineMayRefuse: true,
  };
}

/** Strict read-only envelope validation, not an AWS operation or runtime gate.
 * Reconstruct the original plan from its independently authorized fresh parent.
 * Actual SUCCESS/log evidence must be separately retained by root. */
export function validateNativeFreshCoreCompleted(
  completed,
  expected,
  plan,
  planningInput,
) {
  assert.ok(Buffer.byteLength(JSON.stringify(plan)) <= 1024 * 1024);
  assert.deepEqual(plan, planNativeFreshCore(planningInput));
  exact(expected, [
    "buildId",
    "planSha256",
    "requestSha256",
    "buildspecSha256",
    "imageDigest",
    "imageConfigDigest",
    "receiptSha256",
  ]);
  assert.match(
    expected.buildId,
    /^vaettir-api-build:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );
  for (const k of [
    "planSha256",
    "requestSha256",
    "buildspecSha256",
    "receiptSha256",
  ])
    assert.match(expected[k], hex);
  for (const k of ["imageDigest", "imageConfigDigest"])
    assert.match(expected[k], digest);
  for (const k of ["planSha256", "requestSha256", "buildspecSha256"])
    assert.equal(expected[k], plan[k]);
  assert.notEqual(
    expected.imageDigest,
    plan.identity.prepareExpected.imageDigest,
  );
  assert.notEqual(
    expected.receiptSha256,
    plan.identity.prepareExpected.receiptSha256,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(completed)) <= 512 * 1024);
  exact(completed, [
    "schemaVersion",
    "purpose",
    "status",
    "buildId",
    "planSha256",
    "requestSha256",
    "buildspecSha256",
    "sourceCommit",
    "sourceSha256",
    "imageDigest",
    "imageConfigDigest",
    "receiptSha256",
    "proof",
    "receiptChain",
    "registryManifest",
    "registryConfigBase64",
    ...flags,
  ]);
  assert.equal(completed.schemaVersion, 1);
  assert.equal(completed.purpose, "completed-fresh-native-core");
  assert.equal(completed.status, "SUCCEEDED");
  for (const [k, v] of Object.entries(expected)) assert.equal(completed[k], v);
  assert.equal(completed.sourceCommit, plan.identity.sourceCommit);
  assert.equal(completed.sourceSha256, plan.identity.sourceSha256);
  const p = completed.proof;
  exact(p, [
    "schemaVersion",
    "purpose",
    "planSha256",
    "sourceCommit",
    "sourceSha256",
    "predecessorImageDigest",
    "predecessorReceiptSha256",
    "receiptSha256",
    "receiptBase64",
    "inputsSha256",
    "candidateSha256",
    "abiReceiptSha256",
    "abiReceiptBase64",
    "imageDigest",
    "imageConfigDigest",
    "imageSizeBytes",
    "actualStateVerified",
    "prePushInspection",
    "digestPullEvidence",
    ...flags,
  ]);
  assert.equal(p.schemaVersion, 1);
  assert.equal(p.purpose, "fresh-native-core-phase-evidence");
  for (const k of [
    "planSha256",
    "sourceCommit",
    "sourceSha256",
    "receiptSha256",
    "imageDigest",
    "imageConfigDigest",
  ])
    assert.equal(p[k], completed[k]);
  assert.equal(
    p.predecessorImageDigest,
    plan.identity.prepareExpected.imageDigest,
  );
  assert.equal(
    p.predecessorReceiptSha256,
    plan.identity.prepareExpected.receiptSha256,
  );
  assert.equal(p.inputsSha256, plan.identity.inputsSha256);
  assert.match(p.candidateSha256, hex);
  assert.match(p.abiReceiptSha256, hex);
  assert.equal(p.actualStateVerified, true);
  assert.equal(p.prePushInspection, true);
  assert.equal(p.digestPullEvidence, false);
  assert.ok(
    Number.isSafeInteger(p.imageSizeBytes) &&
      p.imageSizeBytes > 0 &&
      p.imageSizeBytes < 64 * 1024 ** 3,
  );
  for (const v of [completed, p])
    for (const k of flags) assert.equal(v[k], false);
  const base64 = (s, n) => {
    assert.ok(
      typeof s === "string" &&
        s.length <= Math.ceil(n / 3) * 4 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(s),
    );
    const b = Buffer.from(s, "base64");
    assert.ok(b.length > 0 && b.length <= n);
    assert.equal(b.toString("base64"), s);
    return b;
  };
  const receipt = validateNativeCheckpointReceipt(
    base64(p.receiptBase64, 32768),
    {
      phase: "release-core",
      sha256: expected.receiptSha256,
      predecessorSha256: plan.identity.prepareExpected.receiptSha256,
      inputsSha256: plan.identity.inputsSha256,
    },
  );
  assert.equal(receipt.proof.abiReceiptSha256, p.abiReceiptSha256);
  validateCoreAbiBytes(base64(p.abiReceiptBase64, 32768), {
    sha256: receipt.proof.abiReceiptSha256,
    baselineSha256: receipt.inputs.baselineSha256,
    candidateSha256: p.candidateSha256,
  });
  assert.ok(
    Array.isArray(completed.receiptChain) &&
      completed.receiptChain.length === 2,
  );
  assert.deepEqual(completed.receiptChain, [
    {
      phase: "prepare",
      sha256: plan.identity.prepareExpected.receiptSha256,
      base64: plan.identity.prepareReceiptBase64,
    },
    {
      phase: "release-core",
      sha256: expected.receiptSha256,
      base64: p.receiptBase64,
    },
  ]);
  const read = completed.registryManifest;
  assert.deepEqual(read.failures ?? [], []);
  assert.equal(read.images.length, 1);
  const image = read.images[0];
  assert.equal(image.imageId.imageDigest, expected.imageDigest);
  assert.equal(image.imageId.imageTag, plan.candidateTag);
  assert.ok(
    typeof image.imageManifest === "string" &&
      Buffer.byteLength(image.imageManifest) <= 2097152,
  );
  assert.equal("sha256:" + hash(image.imageManifest), expected.imageDigest);
  const manifest = JSON.parse(image.imageManifest);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(
    manifest.mediaType,
    "application/vnd.docker.distribution.manifest.v2+json",
  );
  assert.equal(manifest.config.digest, expected.imageConfigDigest);
  assert.ok(
    Array.isArray(manifest.layers) &&
      manifest.layers.length > 0 &&
      manifest.layers.length <= 100 &&
      manifest.layers.every(
        (l) =>
          digest.test(l.digest) && Number.isSafeInteger(l.size) && l.size > 0,
      ),
  );
  assert.ok(manifest.layers.reduce((n, l) => n + l.size, 0) < 16 * 1024 ** 3);
  const raw = base64(completed.registryConfigBase64, 256 * 1024);
  assert.equal("sha256:" + hash(raw), expected.imageConfigDigest);
  let config;
  try {
    config = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new Error("Unsupported registry configuration encoding or JSON");
  }
  assert.ok(
    config?.os === "linux" && config?.architecture === "amd64",
    "Registry platform mismatch",
  );
  assert.ok(
    config?.rootfs?.type === "layers" &&
      Array.isArray(config.rootfs.diff_ids) &&
      config.rootfs.diff_ids.length === manifest.layers.length &&
      config.rootfs.diff_ids.every(
        (s) => typeof s === "string" && digest.test(s),
      ),
    "Registry rootfs mismatch",
  );
  const labels = config?.config?.Labels;
  for (const [k, v] of Object.entries({
    "vaettir.source-commit": plan.identity.sourceCommit,
    "vaettir.source-sha256": plan.identity.sourceSha256,
    "vaettir.prepare-plan": plan.identity.preparePlanSha256,
    "vaettir.continuation-plan": plan.planSha256,
    "vaettir.runtime-eligible": "false",
    "vaettir.artifact-purpose": "llvm-builder-checkpoint",
  }))
    assert.ok(labels?.[k] === v, "Registry identity label mismatch");
  return {
    receipt,
    receiptSha256: expected.receiptSha256,
    inputsSha256: receipt.inputsSha256,
    imageDigest: expected.imageDigest,
    imageConfigDigest: expected.imageConfigDigest,
    sourceCommit: plan.identity.sourceCommit,
    sourceSha256: plan.identity.sourceSha256,
    actualStateVerified: true,
    unitAcceptance: false,
    packageAcceptance: false,
    runtimeAcceptance: false,
    continuationSupported: false,
  };
}
