// Pure planning only. Externally verified completed-core and reviewed module
// pins grant no dispatch authority here. No import-time I/O or CLI exists.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { validateNativeFreshCoreCompleted } from "./native-builder-fresh-core.mjs";
import { validateNativeCheckpointReceipt } from "./native-builder-continuation.mjs";
import { unpackFreshPrepareOperation } from "./native-builder-fresh-prepare.mjs";
import { nativeValidationShell } from "./native-builder-recovery.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const repository = "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api";
const purpose = "public-native-source-integrity-diagnostic";
const moduleNames = [
  "native-source-inventory-observer.mjs",
  "native-source-diagnostic-transport.mjs",
];
const flags = Object.freeze({
  unitAcceptance: false,
  packageAcceptance: false,
  runtimeAcceptance: false,
  authenticatedAcceptance: false,
  deploymentAcceptance: false,
});
const caps = Object.freeze({
  entries: 400000,
  bytes: 64 * 1024 ** 3,
  fileBytes: 4 * 1024 ** 3,
  snapshotBytes: 64 * 1024 ** 2,
  differences: 512,
  differenceBytes: 1024 ** 2,
  compressedBytes: 32 * 1024 ** 2,
  publicLogBytes: 64 * 1024 ** 2,
});
function exact(value, names) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...names].sort());
}
function moduleBytes(value) {
  exact(value, ["base64", "sha256"]);
  assert.match(value.sha256, /^[a-f0-9]{64}$/);
  assert.ok(typeof value.base64 === "string" && value.base64.length <= 350000);
  const bytes = Buffer.from(value.base64, "base64");
  assert.ok(bytes.length > 0 && bytes.length <= 256 * 1024);
  assert.equal(bytes.toString("base64"), value.base64);
  assert.equal(
    hash(bytes),
    value.sha256,
    "Reviewed module bytes do not match their external pin",
  );
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return bytes;
}
function resources(budget) {
  exact(budget, [
    "mode",
    "containerSeconds",
    "postContainerReserveSeconds",
    "totalSeconds",
  ]);
  assert.deepEqual(budget, {
    mode: "bounded-probe",
    containerSeconds: 2280,
    postContainerReserveSeconds: 90,
    totalSeconds: 2520,
  });
  return {
    ...budget,
    operationSeconds: 2445,
    cleanupGraceSeconds: 75,
    decoderWatchdogSeconds: 2550,
    originalRecipeTimeoutSeconds: 1980,
    originalUnitGateSeconds: 1800,
    cpus: 8,
    memoryBytes: 14 * 1024 ** 3,
    compilerJobs: 5,
    minimumDiskAvailableBytes: 72 * 1024 ** 3,
    forecastAcceptance: false,
  };
}

/** Root separately pins the canonical module closure and ACTUAL core image,
 * performs resource/live-writer admission, seals intent and invokes once.
 * S3 auto-extracted source is not imported, executed, built or re-injected.
 */
export function planNativeSourceDiagnostic(input) {
  exact(input, ["core", "modules", "budget"]);
  exact(input.core, ["completed", "expected", "plan", "planningInput"]);
  assert.ok(Buffer.byteLength(JSON.stringify(input.core)) <= 2 * 1024 ** 2);
  const verified = validateNativeFreshCoreCompleted(
    input.core.completed,
    input.core.expected,
    input.core.plan,
    input.core.planningInput,
  );
  exact(input.modules, moduleNames);
  const reviewedModules = Object.fromEntries(
    moduleNames.map((name) => [
      name,
      {
        bytes: moduleBytes(input.modules[name]),
        sha256: input.modules[name].sha256,
      },
    ]),
  );
  const receipt = verified.receipt;
  const identity = {
    schemaVersion: 1,
    purpose,
    plannerSemanticsSha256: hash(
      [
        planNativeSourceDiagnostic,
        assemble,
        resources,
        moduleBytes,
        exact,
        hash,
        quote,
        nativeValidationShell,
        unpackFreshPrepareOperation,
        validateNativeFreshCoreCompleted,
        validateNativeCheckpointReceipt,
      ]
        .map((fn) => fn.toString())
        .join("\n") +
        JSON.stringify({ repository, purpose, moduleNames, flags, caps }),
    ),
    sourceCommit: verified.sourceCommit,
    sourceArchiveSha256: verified.sourceSha256,
    parent: { ...input.core.expected },
    preparePlanSha256: input.core.plan.identity.preparePlanSha256,
    inputsSha256: verified.inputsSha256,
    expectedSource: { ...receipt.inputs.source },
    expectedScripts: { ...input.core.plan.identity.expectedScripts },
    coreCandidateSha256: input.core.completed.proof.candidateSha256,
    coreAbiReceiptSha256: input.core.completed.proof.abiReceiptSha256,
    receiptChain: input.core.completed.receiptChain.map((item) => ({
      ...item,
    })),
    coreInputs: receipt.inputs,
    coreState: receipt.state,
    modules: Object.fromEntries(
      moduleNames.map((name) => [
        name,
        {
          sha256: reviewedModules[name].sha256,
          bytes: reviewedModules[name].bytes.length,
        },
      ]),
    ),
    resources: resources(input.budget),
    limits: { ...caps },
  };
  assert.equal(Object.keys(identity.expectedScripts).length, 9);
  return assemble(identity, reviewedModules);
}

function assemble(identity, reviewedModules) {
  const planSha256 = hash(JSON.stringify(identity));
  const prefix = "native-source-diagnostic-proof/",
    dir = "/tmp/native-source-diag-" + planSha256;
  const parent = repository + "@" + identity.parent.imageDigest;
  const scope = {
    schemaVersion: 1,
    purpose,
    sourceCommit: identity.sourceCommit,
    sourceArchiveSha256: identity.sourceArchiveSha256,
    parentImageDigest: identity.parent.imageDigest,
    parentImageConfigDigest: identity.parent.imageConfigDigest,
    parentReceiptSha256: identity.parent.receiptSha256,
    observerSha256: identity.modules[moduleNames[0]].sha256,
    diagnosticPlanSha256: planSha256,
    expectedSource: { ...identity.expectedSource },
  };
  const common =
    "const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');const sha=b=>createHash('sha256').update(b).digest('hex');const bounded=(p,n)=>{const s=fs.lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=n);const b=fs.readFileSync(p);assert.equal(b.length,s.size);return b};";
  const disk = `const fs=require('node:fs'),assert=require('node:assert/strict');const s=fs.statfsSync('/var/lib/docker',{bigint:true});assert.ok(s.bavail*s.bsize>=${identity.resources.minimumDiskAvailableBytes}n);`;
  const start = `${common}assert.equal(process.env.VAETTIR_RELEASE_COMMIT,'${identity.sourceCommit}');fs.writeFileSync('${prefix}admission.json',JSON.stringify({planSha256:'${planSha256}',startedNs:process.hrtime.bigint().toString()})+String.fromCharCode(10),{flag:'wx'});`;
  const admit = `${common}const a=JSON.parse(bounded('${prefix}admission.json',512));assert.equal(a.planSha256,'${planSha256}');assert.match(a.startedNs,/^[0-9]{1,30}$/);const elapsed=process.hrtime.bigint()-BigInt(a.startedNs);assert.ok(elapsed>=0n);assert.ok(${identity.resources.operationSeconds}-Number(elapsed/1000000000n)>=${identity.resources.containerSeconds + identity.resources.postContainerReserveSeconds},'Remaining observed deadline cannot admit complete diagnostic; no automatic retry');`;
  const manifest = `${common}const a=JSON.parse(bounded('${prefix}parent-manifest.json',2097152));assert.deepEqual(a.failures??[],[]);assert.equal(a.images.length,1);const i=a.images[0];assert.equal(i.imageId.imageDigest,'${identity.parent.imageDigest}');assert.equal('sha256:'+sha(i.imageManifest),'${identity.parent.imageDigest}');const m=JSON.parse(i.imageManifest);assert.equal(m.schemaVersion,2);assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');assert.equal(m.config.digest,'${identity.parent.imageConfigDigest}');assert.ok(m.layers.length>0&&m.layers.length<=100&&m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<16*1024**3);`;
  const inspect = `${common}const a=JSON.parse(bounded('${prefix}parent-inspect.json',2097152));assert.equal(a.length,1);const[i]=a;assert.equal(i.Id,'${identity.parent.imageConfigDigest}');assert.equal(i.Os,'linux');assert.equal(i.Architecture,'amd64');assert.ok(i.RepoDigests.includes('${parent}'));assert.ok(Number.isSafeInteger(i.Size)&&i.Size>0&&i.Size<64*1024**3);const l=i.Config.Labels;for(const[k,v]of Object.entries(${JSON.stringify({ "vaettir.source-commit": identity.sourceCommit, "vaettir.source-sha256": identity.sourceArchiveSha256, "vaettir.prepare-plan": identity.preparePlanSha256, "vaettir.continuation-plan": identity.parent.planSha256, "vaettir.runtime-eligible": "false", "vaettir.artifact-purpose": "llvm-builder-checkpoint" })}))assert.equal(l[k],v);`;
  const readId = `${common}const p='${prefix}container-id';if(!fs.existsSync(p))process.stdout.write('');else{const id=bounded(p,64).toString('utf8');assert.match(id,/^[a-f0-9]{64}$/);process.stdout.write(id);}`;
  const cleanup = `${common}const a=JSON.parse(bounded('${prefix}cleanup-inspect.json',2097152));assert.equal(a.length,1);const[i]=a;assert.equal(i.Id,bounded('${prefix}container-id',64).toString());assert.equal(i.Image,'${identity.parent.imageConfigDigest}');assert.equal(i.Config.Labels['vaettir.source-diag-owner'],'${planSha256}');assert.deepEqual(i.Mounts,[]);`;
  const containerInspect = `${cleanup.replace("cleanup-inspect.json", "container-inspect.json")}assert.equal(i.Config.Image,'${parent}');assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(i.HostConfig.Privileged,false);assert.deepEqual(i.HostConfig.CapDrop,['ALL']);assert.ok(i.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(i.HostConfig.Memory,15032385536);assert.equal(i.HostConfig.NanoCpus,8000000000);assert.equal(i.HostConfig.PidsLimit,2048);`;
  const modules = `${common}fs.mkdirSync('${prefix}modules',{recursive:false});const modules=${JSON.stringify(Object.fromEntries(moduleNames.map((name) => [name, { ...identity.modules[name], text: reviewedModules[name].bytes.toString("utf8") }])))};for(const[n,m]of Object.entries(modules)){const b=Buffer.from(m.text,'utf8');assert.equal(b.toString('utf8'),m.text);assert.equal(b.length,m.bytes);assert.equal(sha(b),m.sha256);fs.writeFileSync('${prefix}modules/'+n,b,{flag:'wx',mode:0o400});}`;
  // Supplemental read-only checks never call checkpointStore.begin or rewrite
  // the parent. Original recipe.begin supplies the unchanged full gate itself.
  const stableBody = `${common}${validateNativeCheckpointReceipt.toString()};const pins=${JSON.stringify(identity.expectedScripts)},chain=${JSON.stringify(identity.receiptChain.map(({ phase, sha256 }) => ({ phase, sha256 })))},expectedInputs=${JSON.stringify(identity.coreInputs)};function stable(inv,candidate){assert.deepEqual(fs.readdirSync('/build/scripts').sort(),Object.keys(pins).sort());for(const[n,h]of Object.entries(pins))assert.equal(sha(bounded('/build/scripts/'+n,1048576)),h);let prior=null;for(const c of chain){const b=bounded('/build/llvm-phase-receipts/'+c.phase+'.json',32768);validateNativeCheckpointReceipt(b,{phase:c.phase,sha256:c.sha256,predecessorSha256:prior,inputsSha256:'${identity.inputsSha256}'});prior=c.sha256;}assert.deepEqual(inv('/build/scripts'),expectedInputs.scripts);assert.deepEqual(inv('/build/llvm-sources'),expectedInputs.signedSources);assert.equal(sha(bounded('/build/llvm-baseline-library',4294967296)),expectedInputs.baselineSha256);for(const[index,name]of ['llvm-build','llvm-assert-build'].entries()){assert.equal(sha(bounded('/build/'+name+'/CMakeCache.txt',1048576)),expectedInputs.configuration[index].cache);assert.equal(sha(bounded('/build/'+name+'/compile_commands.json',67108864)),expectedInputs.configuration[index].commands);}assert.equal(sha(bounded('/build/llvm-assertion-partitions.json',4194304)),expectedInputs.assertionPlanSha256);const abi=bounded('/build/llvm-early-abi.json',32768);assert.equal(sha(abi),'${identity.coreAbiReceiptSha256}');const a=JSON.parse(abi);assert.equal(a.candidateSha256,'${identity.coreCandidateSha256}');assert.equal(a.baselineSha256,expectedInputs.baselineSha256);assert.equal(a.soname,'libLLVM.so.19.1');assert.equal(a.runtimeAccepted,false);assert.equal(candidate('/build','release-core').sha256,'${identity.coreCandidateSha256}');const exec=require('node:child_process').execFileSync;assert.equal(sha(bounded('/usr/lib/llvm-19/bin/clang',4294967296)),expectedInputs.toolchain.compilerSha256);assert.equal(exec('clang++-19',['--version'],{encoding:'utf8',timeout:30000,maxBuffer:1048576}),expectedInputs.toolchain.compiler);assert.equal(exec('dpkg-query',['-W','-f=\${Version}','clang-19'],{encoding:'utf8',timeout:30000,maxBuffer:1048576}).trim(),expectedInputs.toolchain.compilerPackage);assert.equal(sha(exec('dpkg-query',['-W','-f=\${Package}\\t\${Version}\\t\${Architecture}\\n'],{encoding:'utf8',timeout:30000,maxBuffer:33554432})),expectedInputs.toolchain.installedPackagesSha256);}`;
  const runner = `${stableBody};async function diagnostic(){const moduleDir='${dir}',modulePins=${JSON.stringify(identity.modules)};assert.equal(fs.realpathSync(moduleDir),moduleDir);assert.ok(fs.lstatSync(moduleDir).isDirectory());assert.deepEqual(fs.readdirSync(moduleDir).sort(),Object.keys(modulePins).sort());for(const[n,m]of Object.entries(modulePins)){const b=bounded(moduleDir+'/'+n,262144);assert.equal(b.length,m.bytes);assert.equal(sha(b),m.sha256);}assert.deepEqual(fs.readdirSync('/build/scripts').sort(),Object.keys(pins).sort());for(const[n,h]of Object.entries(pins))assert.equal(sha(bounded('/build/scripts/'+n,1048576)),h);const {inventoryTree,hashCandidateLibrary}=await import('/build/scripts/native-llvm-checkpoint.mjs');stable(inventoryTree,hashCandidateLibrary);assert.ok(!fs.existsSync('/build/llvm-phase-active.json'));assert.deepEqual(fs.readdirSync('/build/llvm-phase-receipts').sort(),['prepare.json','release-core.json']);assert.deepEqual(inventoryTree('/build/llvm-build'),${JSON.stringify(identity.coreState.release)});assert.deepEqual(inventoryTree('/build/llvm-assert-build'),${JSON.stringify(identity.coreState.assertions)});const concurrency=require('node:child_process').execFileSync(process.execPath,['/build/scripts/native-build-concurrency.mjs'],{encoding:'utf8',timeout:30000,maxBuffer:4096}).trim();assert.equal(concurrency,'5');const {captureNativeSourceInventory,diffNativeSourceInventories}=await import(moduleDir+'/${moduleNames[0]}');const {encodeNativeSourceDiagnosticTransport}=await import(moduleDir+'/${moduleNames[1]}');const scope=${JSON.stringify(scope)},context={schemaVersion:1,purpose:'${purpose}',sourceRoot:'/build/llvm-source',parentImageDigest:scope.parentImageDigest,parentReceiptSha256:scope.parentReceiptSha256,expectedSource:scope.expectedSource};let before,after,difference,recipeExitCode=null,recipeSignal=null,recipeAttempted=false,afterAttempted=false,complete=false;try{before=captureNativeSourceInventory(context,'BEFORE');recipeAttempted=true;try{const r=require('node:child_process').spawnSync('timeout',['--signal=TERM','--kill-after=20s','1980s','sh','/build/scripts/build-llvm-runtime.sh','--phase','release-units','--predecessor-sha256','${identity.parent.receiptSha256}'],{stdio:'inherit',timeout:2005000,killSignal:'SIGTERM'});recipeExitCode=r.status;recipeSignal=r.signal;if(r.error)throw r.error;assert.ok(Number.isSafeInteger(recipeExitCode)&&recipeExitCode>=0&&recipeExitCode<=255);assert.equal(recipeSignal,null);}finally{afterAttempted=true;after=captureNativeSourceInventory(context,'AFTER');difference=diffNativeSourceInventories(before,after);}stable(inventoryTree,hashCandidateLibrary);const lines=encodeNativeSourceDiagnosticTransport({before,after,difference},scope);let bytes=0;for(const line of lines){bytes+=Buffer.byteLength(line)+1;assert.ok(bytes<=67108864);console.log(line);}complete=true;}finally{console.log('PUBLIC_NATIVE_SOURCE_DIAGNOSTIC_STATUS='+JSON.stringify({schemaVersion:1,purpose:'${purpose}',diagnosticPlanSha256:'${planSha256}',recipeAttempted,recipeExitCode,recipeSignal,afterAttempted,complete,...${JSON.stringify(flags)}}));}assert.equal(complete,true);}diagnostic().catch(e=>{console.error('Public source diagnostic refused: '+e.name);process.exitCode=1});`;
  const commands = [
    "trap 'exit 124' TERM",
    'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
    `mkdir ${prefix.slice(0, -1)}`,
    `timeout 20s node -e ${quote(start)}`,
    `cleanup_native_validation() { case "$native_validation_container" in '') return 0 ;; *[!0-9a-f]*) return 70 ;; esac; test "\${#native_validation_container}" = 64 || return 70; timeout 20s docker inspect "$native_validation_container" >${prefix}cleanup-inspect.json || return 70; timeout 20s node -e ${quote(cleanup)} || return 70; timeout 20s docker rm -f "$native_validation_container" >/dev/null; }`,
    "timeout 20s docker info >/dev/null",
    `timeout 20s node -e ${quote(disk)}`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageDigest=${identity.parent.imageDigest} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json >${prefix}parent-manifest.json`,
    `timeout 20s node -e ${quote(manifest)}`,
    "timeout 60s aws ecr get-login-password --region us-east-2 | timeout 60s docker login --username AWS --password-stdin 051722405355.dkr.ecr.us-east-2.amazonaws.com",
    `timeout --signal=TERM --kill-after=20s 300s docker pull ${parent}`,
    `timeout 20s docker image inspect ${parent} >${prefix}parent-inspect.json`,
    `timeout 20s node -e ${quote(inspect)}`,
    `timeout 20s node -e ${quote(modules)}`,
    "native_create_status=0",
    `timeout 30s docker create --cidfile ${prefix}container-id --label vaettir.source-diag-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --entrypoint node ${parent} -e ${quote(runner)} >${prefix}create-output.txt || native_create_status=$?`,
    `native_validation_container=$(timeout 20s node -e ${quote(readId)})`,
    'test "$native_create_status" = 0',
    'test -n "$native_validation_container"',
    `timeout 20s docker inspect "$native_validation_container" >${prefix}container-inspect.json`,
    `timeout 20s node -e ${quote(containerInspect)}`,
    `timeout 30s docker cp ${prefix}modules "$native_validation_container:${dir}"`,
    `timeout 20s node -e ${quote(admit)}`,
    "native_diagnostic_status=0",
    `timeout --signal=TERM --kill-after=20s 2280s docker start -a "$native_validation_container" || native_diagnostic_status=$?`,
    'test "$native_diagnostic_status" = 0',
    'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_validation_container")" = 0',
    "cleanup_native_validation",
    "native_validation_container=''",
    `echo 'PUBLIC_NATIVE_SOURCE_DIAGNOSTIC_CLEANED=${planSha256}'`,
  ];
  const operation = `timeout --signal=TERM --kill-after=75s 2445s ${nativeValidationShell(commands)}`;
  assert.doesNotMatch(
    operation,
    /describe-images|put-object|update-project|put-role-policy|docker (commit|push|build|tag)|aws s3api|unzip|--phase final|checkpointStore\(\)\.begin|rm -- .*llvm/,
  );
  const raw = Buffer.from(operation),
    compressed = gzipSync(raw, { level: 9 });
  assert.ok(raw.length <= 512 * 1024 && compressed.length <= 128 * 1024);
  const transport = {
    encoding: "gzip-base64-sha256-v1",
    decodedSha256: hash(raw),
    decodedBytes: raw.length,
    compressedSha256: hash(compressed),
    compressedBytes: compressed.length,
    base64: compressed.toString("base64"),
  };
  assert.equal(unpackFreshPrepareOperation(transport), operation);
  const decoder = `const assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{gunzipSync}=require("node:zlib"),{spawnSync}=require("node:child_process");const p=${JSON.stringify(transport)},sha=b=>createHash("sha256").update(b).digest("hex");assert.equal(p.encoding,"gzip-base64-sha256-v1");assert.deepEqual(Object.keys(p).sort(),["base64","compressedBytes","compressedSha256","decodedBytes","decodedSha256","encoding"]);for(const k of ["decodedSha256","compressedSha256"])assert.match(p[k],/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(p.compressedBytes)&&p.compressedBytes>0&&p.compressedBytes<=131072);assert.ok(Number.isSafeInteger(p.decodedBytes)&&p.decodedBytes>0&&p.decodedBytes<=524288);assert.ok(typeof p.base64==="string"&&p.base64.length<=174764);const c=Buffer.from(p.base64,"base64");assert.equal(c.toString("base64"),p.base64);assert.equal(c.length,p.compressedBytes);assert.equal(sha(c),p.compressedSha256);const b=gunzipSync(c,{maxOutputLength:524288});assert.equal(b.length,p.decodedBytes);assert.equal(sha(b),p.decodedSha256);const operation=new TextDecoder("utf-8",{fatal:true}).decode(b);assert.equal(Buffer.from(operation).length,b.length);assert.ok(operation.startsWith("timeout --signal=TERM --kill-after=75s 2445s bash -eu -o pipefail -c "+String.fromCharCode(39)));const r=spawnSync("/bin/bash",["-eu","-o","pipefail","-c",operation],{stdio:"inherit",timeout:2550000,killSignal:"SIGTERM"});if(r.error)throw r.error;assert.equal(r.signal,null);assert.equal(r.status,0);`;
  const spec = {
    version: "0.2",
    phases: {
      build: { commands: [`node -e ${quote(decoder)}`] },
      post_build: {
        commands: [
          'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
          'echo "SOURCE DIAGNOSTIC ONLY. NO NATIVE/RUNTIME ACCEPTANCE."',
        ],
      },
    },
  };
  const request = {
    projectName: "vaettir-api-build",
    sourceTypeOverride: "S3",
    sourceLocationOverride: `vaettir-build-source-051722405355/releases/${identity.sourceCommit}/source.zip`,
    buildspecOverride: JSON.stringify(spec),
    timeoutInMinutesOverride: 45,
    computeTypeOverride: "BUILD_GENERAL1_LARGE",
    environmentVariablesOverride: [
      {
        name: "VAETTIR_RELEASE_COMMIT",
        value: identity.sourceCommit,
        type: "PLAINTEXT",
      },
    ],
    idempotencyToken: "native-source-diag-" + planSha256.slice(0, 40),
    autoRetryLimitOverride: 0,
  };
  assert.ok(
    Buffer.byteLength(request.buildspecOverride) <= 25600,
    "CodeBuild request exceeds actual25600-byte limit: " +
      Buffer.byteLength(request.buildspecOverride),
  );
  return {
    identity,
    scope,
    planSha256,
    request,
    requestSha256: hash(JSON.stringify(request)),
    buildspecSha256: hash(request.buildspecOverride),
    importedImage: parent,
    operation,
    transport,
    generatedPrograms: {
      disk,
      start,
      admit,
      manifest,
      inspect,
      readId,
      cleanup,
      containerInspect,
      modules,
      stableBody,
      runner,
      decoder,
    },
    ...flags,
    dispatchRequiresRootPreflight: true,
    globalDeadlineMayRefuse: true,
    afterGuaranteed: false,
    successorImageSupported: false,
    defaultRuntimeGraphChanged: false,
  };
}
