// PURE prospective transport assembly. No import-time IO/subprocess/cloud.
// Full native recipe/pre/committed-image reviews are required before export.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { nativeValidationShell } from "./native-builder-recovery.mjs";
import { unpackFreshPrepareOperation } from "./native-packaging-v2-builder-fresh-prepare.mjs";

const sha = b => createHash("sha256").update(b).digest("hex");
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
const phases = ["prepare", "release-core", "release-units", "assertion-compile-1", "assertion-compile-2", "assertion-compile-3", "final"];
export const COMPACT_ARTIFACT_PATHS = Object.freeze([
  "/build/libllvm19_19.1.7-3+vaettir1_amd64.deb", "/build/llvm-cpu-jit", "/build/llvm-arm-policy",
  "/build/llvm-stripped-abi.json", "/build/llvm-abi.json", "/build/llvm-final-unit-gates.json",
  "/build/llvm-release-configuration.json", "/build/llvm-assertions-configuration.json",
  ...phases.map(p => `/build/llvm-phase-receipts/${p}.json`),
]);

/** Shared generated program and actual pure synthetic-test boundary. Source
 * and copied files have their own inode identities; only bytes/modes cross.
 */
export function inspectCompactArtifactFiles(fs, root, paths, expectedHashes, expectedInventory, exactTree, hashFactory, assertion) {
  const a = assertion;
  a.equal(paths.length, 15); a.equal(expectedHashes.length, 15);
  a.ok(root.startsWith("/") && !root.split("/").includes(".."));
  const directory = path => { const s=fs.lstatSync(path); a.ok(s.isDirectory()&&!s.isSymbolicLink()); a.equal(fs.realpathSync(path),path); };
  directory(root); directory(root+"/llvm-phase-receipts");
  if(exactTree){
    a.deepEqual(fs.readdirSync(root).sort(), paths.slice(0,8).map(p=>p.slice(7)).concat("llvm-phase-receipts").sort());
    a.deepEqual(fs.readdirSync(root+"/llvm-phase-receipts").sort(),paths.slice(8).map(p=>p.split("/").at(-1)).sort());
  }
  const identity = s => [s.dev,s.ino,s.size,s.mode,s.mtimeMs,s.ctimeMs];
  let total=0;
  const inventory=paths.map((path,index)=>{
    const local=root+path.slice(6); a.equal(fs.realpathSync(local),local);
    const before=fs.lstatSync(local); a.ok(before.isFile()&&!before.isSymbolicLink());
    const cap=index===0?512*1024**2:index<=2?128*1024**2:32768;
    a.ok(Number.isSafeInteger(before.size)&&before.size>0&&before.size<=cap);
    const mode=before.mode&4095;
    if(index===1||index===2)a.equal(mode,493); else if(index>=8)a.equal(mode,384); else a.ok(mode===384||mode===420);
    const fd=fs.openSync(local,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    let bytes=0; const hash=hashFactory("sha256"),block=Buffer.alloc(1048576);
    try {
      a.deepEqual(identity(fs.fstatSync(fd)),identity(before));
      let n; while((n=fs.readSync(fd,block,0,block.length,null))>0){bytes+=n;a.ok(bytes<=before.size);hash.update(block.subarray(0,n));}
      a.equal(bytes,before.size); a.deepEqual(identity(fs.fstatSync(fd)),identity(before));a.deepEqual(identity(fs.lstatSync(local)),identity(before));
      a.equal(fs.realpathSync(local),local);
    } finally {fs.closeSync(fd);}
    const record={path,sha256:hash.digest("hex"),bytes,mode}; a.equal(record.sha256,expectedHashes[index]);
    if(expectedInventory)a.deepEqual(record,expectedInventory[index]); total+=bytes; return record;
  });
  a.ok(total<=805699584); return {inventory,inventorySha256:hashFactory("sha256").update(JSON.stringify(inventory)).digest("hex")};
}

const policy = Object.freeze({transportKind:"compact-fixed15-v1",paths:COMPACT_ARTIFACT_PATHS,artifactMaximumBytes:805699584,exportSeconds:120,buildSeconds:100,readbackSeconds:120,cleanupSeconds:60,pushSeconds:180,pushReserveSeconds:525,scratchRecipeOnly:true,neverStartScratch:true});
export const COMPACT_TRANSPORT_POLICY_SHA256 = sha(JSON.stringify(policy)+inspectCompactArtifactFiles.toString()+assembleNativeCompactFinal.toString());

export function assembleNativeCompactFinal(full) {
  assert.equal(full.identity.transportKind,"compact-fixed15-v1");
  assert.equal(full.identity.compactTransportPolicySha256,COMPACT_TRANSPORT_POLICY_SHA256);
  assert.equal(full.planSha256,sha(JSON.stringify(full.identity)));
  assert.equal(unpackFreshPrepareOperation(full.transport),full.operation);
  const prefix="native-fresh-final-proof/",dir=full.externalDirectory, planSha256=full.planSha256;
  const compactImage=full.candidateImage.replace(":final-",":compact-final-");
  assert.notEqual(compactImage,full.candidateImage);
  const preamble="const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),path=require('node:path');const sha=b=>createHash('sha256').update(b).digest('hex');const bounded=(p,n)=>{const s=fs.lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=n);const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{assert.equal(fs.fstatSync(fd).ino,s.ino);const b=fs.readFileSync(fd);assert.equal(b.length,s.size);assert.equal(fs.fstatSync(fd).ino,s.ino);assert.equal(fs.lstatSync(p).ino,s.ino);return b;}finally{fs.closeSync(fd)}};";
  const inspector=`const inspect=${inspectCompactArtifactFiles.toString()};const paths=${JSON.stringify(COMPACT_ARTIFACT_PATHS)};`;
  const sourceInventory=`${preamble}${inspector}const review=JSON.parse(bounded('${dir}/image-review.json',262144)),raw=Buffer.from(review.finalReceiptBase64,'base64'),r=JSON.parse(raw),p=r.proof;assert.equal(sha(raw),review.review.finalReceiptSha256);const hashes=[p.packageSha256,p['llvm-cpu-jit'],p['llvm-arm-policy'],p.abiReceiptSha256,p['llvm-abi.json'],p.unitReceiptSha256,p['llvm-release-configuration.json'],p['llvm-assertions-configuration.json'],...${JSON.stringify(full.identity.receipts)}.map(r=>r.sha256),sha(raw)];const artifacts=inspect(fs,'/build',paths,hashes,null,false,createHash,assert);fs.writeFileSync('${dir}/compact-artifacts.json',JSON.stringify(artifacts),{flag:'wx',mode:0o600});`;
  const oldBootstrap=full.generatedPrograms.bootstrapImage;
  const bootstrapAnchor="await runtime('image',c);";
  assert.equal(oldBootstrap.split(bootstrapAnchor).length,2);
  const bootstrap=oldBootstrap.replace(bootstrapAnchor,bootstrapAnchor+`{${sourceInventory}}`);
  const inventoryRead=`const artifacts=JSON.parse(bounded('${prefix}compact-artifacts.json',16384));assert.equal(artifacts.inventory.length,15);assert.equal(artifacts.inventorySha256,sha(JSON.stringify(artifacts.inventory)));const hashes=artifacts.inventory.map(e=>e.sha256);`;
  const scratchRecipe=JSON.stringify("FROM scratch\nCOPY build /build/\n");
  const verifyContext=`${preamble}${inspector}${inventoryRead}const root=path.resolve('${prefix}compact-context/build');assert.equal(fs.realpathSync(root),root);assert.deepEqual(inspect(fs,root,paths,hashes,artifacts.inventory,true,createHash,assert),artifacts);assert.deepEqual(fs.readdirSync(path.resolve('${prefix}compact-context')).sort(),['Dockerfile','build']);assert.equal(bounded('${prefix}compact-context/Dockerfile',8192).toString(),${scratchRecipe});`;
  const setup=`${preamble}for(const p of ['${prefix}compact-context','${prefix}compact-context/build','${prefix}compact-context/build/llvm-phase-receipts','${prefix}compact-readback']){assert.equal(fs.existsSync(p),false);fs.mkdirSync(p,{mode:0o700});}fs.writeFileSync('${prefix}compact-context/Dockerfile',${scratchRecipe},{flag:'wx',mode:0o400});`;
  const admission=`${preamble}const c=JSON.parse(bounded('${prefix}clock.json',512));assert.ok(BigInt(c.deadlineNs)-process.hrtime.bigint()>=${(120+100+120+60+525)*1000000000}n,'Original clock cannot admit compact export/build/readback and publication');`;
  const labels={"vaettir.source-commit":full.identity.sourceCommit,"vaettir.source-sha256":full.identity.sourceSha256,"vaettir.prepare-plan":full.identity.preparePlanSha256,"vaettir.continuation-plan":planSha256,"vaettir.continuation-phase":"final-compact","vaettir.runtime-eligible":"false","vaettir.artifact-purpose":"llvm-final-artifact-donor","vaettir.final-owner":planSha256,"vaettir.transport-kind":"compact-fixed15-v1"};
  const donorIdentity=`${preamble}${inventoryRead}const i=JSON.parse(bounded('${prefix}compact-image-inspect.json',2097152));assert.equal(i.length,1);const x=i[0],id=bounded('${prefix}compact-id',80).toString().trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);assert.equal(x.Id,id);assert.equal(x.Os,'linux');assert.equal(x.Architecture,'amd64');assert.ok(x.Size>0&&x.Size<1073741824);assert.equal(x.RootFS.Type,'layers');assert.equal(x.RootFS.Layers.length,1);assert.match(x.RootFS.Layers[0],/^sha256:[a-f0-9]{64}$/);for(const[k,v]of Object.entries(${JSON.stringify(labels)}))assert.equal(x.Config.Labels[k],v);const full=bounded('${prefix}commit-id',80).toString().trim();assert.match(full,/^sha256:[a-f0-9]{64}$/);assert.notEqual(id,full);assert.equal(x.Config.Labels['vaettir.full-local-image-config'],full);assert.equal(x.Config.Labels['vaettir.artifact-inventory-sha256'],artifacts.inventorySha256);const proof=JSON.parse(bounded('${prefix}verified.json',524288));assert.equal(x.Config.Labels['vaettir.final-receipt-sha256'],proof.pre.review.finalReceiptSha256);`;
  const scratchGuard=`${preamble}const a=JSON.parse(bounded('${prefix}compact-inspect.json',2097152));assert.equal(a.length,1);const x=a[0];assert.equal(x.Id,bounded('${prefix}compact-cid',64).toString());assert.equal(x.Image,bounded('${prefix}compact-id',80).toString().trim());assert.equal(x.Config.Labels['vaettir.final-owner'],'${planSha256}');assert.equal(x.State.Running,false);assert.equal(x.State.Status,'created');assert.deepEqual(x.Mounts,[]);assert.equal(x.HostConfig.NetworkMode,'none');assert.equal(x.HostConfig.Privileged,false);assert.deepEqual(x.HostConfig.CapDrop,['ALL']);assert.ok(x.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(x.HostConfig.Memory,15032385536);assert.equal(x.HostConfig.NanoCpus,8000000000);assert.equal(x.HostConfig.PidsLimit,2048);`;
  const committedReadback=`${preamble}${inspector}${inventoryRead}const root=path.resolve('${prefix}compact-readback/build');assert.equal(fs.realpathSync(root),root);assert.deepEqual(fs.readdirSync(path.resolve('${prefix}compact-readback')),['build']);assert.deepEqual(inspect(fs,root,paths,hashes,artifacts.inventory,true,createHash,assert),artifacts);fs.writeFileSync('${prefix}compact-committed.json',JSON.stringify({transportKind:'compact-fixed15-v1',fullLocalImageConfigDigest:bounded('${prefix}commit-id',80).toString().trim(),compactArtifacts:artifacts,committedCompactFilesVerified:true,compactRootFsLayers:1}),{flag:'wx',mode:0o600});`;
  const dynamicLabels=`--label vaettir.full-local-image-config="$(cat ${prefix}commit-id)" --label vaettir.artifact-inventory-sha256="$(node -e ${quote(preamble+inventoryRead+"process.stdout.write(artifacts.inventorySha256);")})" --label vaettir.final-receipt-sha256="$(node -e ${quote(preamble+`process.stdout.write(JSON.parse(bounded('${prefix}verified.json',524288)).pre.review.finalReceiptSha256);`)})"`;
  const exportCommands=[
    `native_final_image=$(timeout 20s node -e ${quote(preamble+`process.stdout.write(bounded('${prefix}image-cid',64).toString());`)})`,
    `timeout 20s node -e ${quote(setup)}`,
    `timeout 20s docker cp -a "$native_final_image:${dir}/compact-artifacts.json" ${prefix}compact-artifacts.json`,
    ...COMPACT_ARTIFACT_PATHS.map(p=>`timeout 20s docker cp -a "$native_final_image:${p}" ${prefix}compact-context${p}`),
    `timeout 60s node -e ${quote(verifyContext)}`,
  ];
  const buildCommands=[
    `timeout --signal=TERM --kill-after=20s 80s docker build --network=none --no-cache --platform linux/amd64 --tag ${compactImage} --iidfile ${prefix}compact-id ${Object.entries(labels).map(([k,v])=>"--label "+quote(k+"="+v)).join(" ")} ${dynamicLabels} ${prefix}compact-context`,
    `timeout 20s docker image inspect ${compactImage} >${prefix}compact-image-inspect.json`,
    `timeout 20s node -e ${quote(donorIdentity)}`,
  ];
  const readbackCommands=[
    `timeout 30s docker create --cidfile ${prefix}compact-cid --label vaettir.final-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --entrypoint /never-executed ${compactImage}`,
    `native_compact_id=$(node -e ${quote(preamble+`process.stdout.write(bounded('${prefix}compact-cid',64).toString());`)})`,
    `timeout 20s docker inspect "$native_compact_id" >${prefix}compact-inspect.json`,
    `timeout 20s node -e ${quote(scratchGuard)}`,
    `timeout 30s docker cp -a "$native_compact_id:/build" ${prefix}compact-readback/`,
    `timeout 60s node -e ${quote(committedReadback)}`,
  ];
  const compactCommands=[`timeout 20s node -e ${quote(admission)}`,
    `timeout --signal=TERM --kill-after=20s 100s ${nativeValidationShell(exportCommands)}`,
    // Parent owns cleanup; child shells never inherit/guess its state.
    "cleanup_native_validation",
    `timeout --signal=TERM --kill-after=20s 80s ${nativeValidationShell(buildCommands)}`,
    `timeout --signal=TERM --kill-after=20s 100s ${nativeValidationShell(readbackCommands)}`];
  const registry=full.generatedPrograms.registry.replaceAll(prefix+"commit-id",prefix+"compact-id").replaceAll(full.candidateImage.split(":").at(-1),compactImage.split(":").at(-1))
    .replace("assert.ok(m.layers.length>0&&m.layers.length<=100&&", "assert.equal(m.config.mediaType,'application/vnd.docker.container.image.v1+json');assert.ok(Number.isSafeInteger(m.config.size)&&m.config.size>0&&m.config.size<=262144);assert.equal(m.layers.length,1);assert.equal(m.layers[0].mediaType,'application/vnd.docker.image.rootfs.diff.tar.gzip');assert.ok(m.layers.length===1&&")
    .replace("<16*1024**3", "<1073741824");
  let readback=full.generatedPrograms.configReadback;
  const labelAnchor=JSON.stringify({"vaettir.source-commit":full.identity.sourceCommit,"vaettir.source-sha256":full.identity.sourceSha256,"vaettir.continuation-plan":planSha256,"vaettir.continuation-phase":"final","vaettir.runtime-eligible":"false","vaettir.artifact-purpose":"llvm-builder-checkpoint","vaettir.final-owner":planSha256});
  assert.equal(readback.split(labelAnchor).length,2);
  readback=readback.replace(labelAnchor,JSON.stringify(labels));
  const envGuard="assert.deepEqual(c.config.Env.filter(x=>x.startsWith('PYTHONDONTWRITEBYTECODE=')),['PYTHONDONTWRITEBYTECODE=1']);";
  assert.equal(readback.split(envGuard).length,2);
  readback=readback.replace(envGuard,`assert.deepEqual(c.rootfs.type,'layers');assert.equal(c.rootfs.diff_ids.length,1);const compact=JSON.parse(bounded('${prefix}compact-committed.json',32768));assert.equal(c.config.Labels['vaettir.full-local-image-config'],compact.fullLocalImageConfigDigest);assert.equal(c.config.Labels['vaettir.artifact-inventory-sha256'],compact.compactArtifacts.inventorySha256);`);
  readback=readback.replace("assert.equal(bytes.length,declared);",`assert.equal(bytes.length,declared);assert.equal(JSON.parse(JSON.parse(bounded('${prefix}registry.json',2097152)).images[0].imageManifest).config.size,bytes.length);`);
  readback=readback.replace("NATIVE_FRESH_FINAL_VERIFIED=","NATIVE_FRESH_COMPACT_FINAL_VERIFIED=");
  const proofAnchor="{...proof,...expected,registryRawConfigSha256:sha(bytes),";
  assert.equal(readback.split(proofAnchor).length,2);
  readback=readback.replace(proofAnchor,"{...proof,...expected,...compact,schemaVersion:2,purpose:'verified-fresh-native-compact-final',registryRawConfigSha256:sha(bytes),");
  const shellPrefix="timeout --signal=TERM --kill-after=75s 2445s bash -eu -o pipefail -c ";
  assert.ok(full.operation.startsWith(shellPrefix));
  const quoted=full.operation.slice(shellPrefix.length);assert.ok(quoted.startsWith("'")&&quoted.endsWith("'"));
  let shell=quoted.slice(1,-1).replaceAll("'\\''","'");assert.equal(quote(shell),quoted);
  const replace=(before,after)=>{assert.equal(shell.split(before).length,2,"Exact legacy assembly anchor required");shell=shell.replace(before,after);};
  replace(quote(oldBootstrap),quote(bootstrap));
  const compareCommand=`timeout 20s node -e ${quote(full.generatedPrograms.compare)}`;
  replace(compareCommand,compareCommand+"\n"+compactCommands.join("\n"));
  replace(`docker push ${full.candidateImage}`,`docker push ${compactImage}`);
  replace(`imageTag=${full.candidateImage.split(":").at(-1)}`,`imageTag=${compactImage.split(":").at(-1)}`);
  replace(quote(full.generatedPrograms.registry),quote(registry));
  replace(quote(full.generatedPrograms.configReadback),quote(readback));
  const registryPushAdmission=full.generatedPrograms.registryPushAdmission.replace("945000000000n","525000000000n");
  assert.notEqual(registryPushAdmission,full.generatedPrograms.registryPushAdmission);
  replace(quote(full.generatedPrograms.registryPushAdmission),quote(registryPushAdmission));
  replace("600s docker push", "180s docker push");
  const readCleanupIds=full.generatedPrograms.readCleanupIds.replace("['image','pre','recipe']","['image','pre','recipe','compact']");
  assert.notEqual(readCleanupIds,full.generatedPrograms.readCleanupIds);
  replace(quote(full.generatedPrograms.readCleanupIds),quote(readCleanupIds));
  const cleanupAnchor=`else{assert.equal(i.Id,bounded('${prefix}image-cid',64).toString());`;
  const compactCleanup=`else if(fs.existsSync('${prefix}compact-cid')&&i.Id===bounded('${prefix}compact-cid',64).toString()){assert.equal(i.Image,bounded('${prefix}compact-id',80).toString().trim());assert.equal(i.State.Running,false);assert.equal(i.State.Status,'created');assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(i.HostConfig.Privileged,false);assert.deepEqual(i.HostConfig.CapDrop,['ALL']);assert.ok(i.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(i.HostConfig.Memory,15032385536);assert.equal(i.HostConfig.NanoCpus,8000000000);assert.equal(i.HostConfig.PidsLimit,2048);}else{assert.equal(i.Id,bounded('${prefix}image-cid',64).toString());`;
  assert.equal(full.generatedPrograms.cleanup.split(cleanupAnchor).length,2);
  const cleanup=full.generatedPrograms.cleanup.replace(cleanupAnchor,compactCleanup);
  replace(quote(full.generatedPrograms.cleanup),quote(cleanup));
  replace(`NATIVE_FRESH_FINAL_CLEANED=${planSha256}`,`NATIVE_FRESH_COMPACT_FINAL_CLEANED=${planSha256}`);
  const operation=shellPrefix+quote(shell);
  const raw=Buffer.from(operation),compressed=gzipSync(raw,{level:9});assert.ok(raw.length<=524288&&compressed.length<=131072);
  const transport={encoding:"gzip-base64-sha256-v1",decodedSha256:sha(raw),decodedBytes:raw.length,compressedSha256:sha(compressed),compressedBytes:compressed.length,base64:compressed.toString("base64")};
  assert.equal(unpackFreshPrepareOperation(transport),operation);
  const decoder=`const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{gunzipSync}=require('node:zlib'),{spawnSync}=require('node:child_process');const p=${JSON.stringify(transport)},sha=b=>createHash('sha256').update(b).digest('hex');const c=Buffer.from(p.base64,'base64');assert.equal(c.toString('base64'),p.base64);assert.equal(c.length,p.compressedBytes);assert.equal(sha(c),p.compressedSha256);const b=gunzipSync(c,{maxOutputLength:524288});assert.equal(b.length,p.decodedBytes);assert.equal(sha(b),p.decodedSha256);const operation=new TextDecoder('utf-8',{fatal:true}).decode(b);const r=spawnSync('/bin/bash',['-eu','-o','pipefail','-c',operation],{stdio:'inherit',timeout:2550000,killSignal:'SIGTERM'});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0);`;
  const buildspec=JSON.parse(full.request.buildspecOverride);buildspec.phases.build.commands=["node -e "+quote(decoder)];
  const buildspecRaw=JSON.stringify(buildspec);assert.ok(Buffer.byteLength(buildspecRaw)<=25600,"No buildspec bound increase permitted");
  const request={...full.request,buildspecOverride:buildspecRaw};
  return {...full,operation,transport,request,requestSha256:sha(JSON.stringify(request)),buildspecSha256:sha(buildspecRaw),candidateImage:compactImage,fullLocalCandidateImage:full.candidateImage,
    generatedPrograms:{...full.generatedPrograms,bootstrapImage:bootstrap,sourceInventory,setup,verifyContext,compactAdmission:admission,donorIdentity,scratchGuard,committedReadback,registry,configReadback:readback,registryPushAdmission,readCleanupIds,cleanup,decoder},
    generatedCompactShells:{export:exportCommands.join("\n"),build:buildCommands.join("\n"),readback:readbackCommands.join("\n")},compactTransportPolicy:policy};
}
