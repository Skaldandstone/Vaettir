// Actual generated pure programs and in-memory filesystem/daemon metadata.
// No Docker/compiler/AWS/DB/provider/native acceptance or helper modes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import * as legacy from './native-builder-fresh-final-plan.mjs';
import * as v2 from './native-packaging-v2-builder-fresh-final-plan.mjs';
import {finalFixture} from './native-final-runtime-recipe-fixture.mjs';
import {nativeValidationShell} from './native-builder-recovery.mjs';
import {unpackFreshPrepareOperation} from './native-packaging-v2-builder-fresh-prepare.mjs';
import {NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS} from './native-final-runtime-recipe.mjs';
import {COMPACT_ARTIFACT_PATHS, COMPACT_TRANSPORT_POLICY_SHA256, inspectCompactArtifactFiles, assembleNativeCompactFinal} from './native-final-compact-transport.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const flags={unitAcceptance:false,packageAcceptance:false,runtimeAcceptance:false,authenticatedAcceptance:false,deploymentAcceptance:false};
// Same actual V2 assembly exercised by existing isolation tests, explicitly
// synthetic V1-derived identity. This does not claim genuine V2 parent proof.
export function syntheticCompactAssemblyFixture(){
  const source=readFileSync(new URL('./native-packaging-v2-builder-fresh-final-plan.mjs',import.meta.url),'utf8');
  const start=source.indexOf('function assemble(identity) {'),end=source.indexOf('\n/** Prospective transport only.',start);
  assert.ok(start>0&&end>start);
  const assemble=new Script(source.slice(start,end)+'\nassemble').runInNewContext({Buffer,TextDecoder,assert,gzipSync,sha,quote,nativeValidationShell,unpackFreshPrepareOperation,nativeFinalPublicFailure:v2.nativeFinalPublicFailure,repository:'051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api',bucket:'vaettir-build-source-051722405355',flags},{timeout:2000});
  const original=legacy.planNativeFreshFinal(finalFixture());
  const identity={...original.identity,purpose:'native-packaging-v2-fresh-final-plan-not-runtime'};
  const old=assemble(identity);
  const full=assemble({...identity,transportKind:'compact-fixed15-v1',compactTransportPolicySha256:COMPACT_TRANSPORT_POLICY_SHA256});
  return {old,full,compact:assembleNativeCompactFinal(full)};
}
let cached;
const fixture=()=>cached??=(syntheticCompactAssemblyFixture());
function memory(root='/build'){
  const files=new Map(),dirs=new Set([root,root+'/llvm-phase-receipts']),fds=new Map();let next=1;
  const inode=new Map(),modes=new Map();
  const inventory=COMPACT_ARTIFACT_PATHS.map((path,index)=>{
    const local=root+path.slice(6),raw=Buffer.from('synthetic exact public artifact '+index+'\n');
    files.set(local,raw);inode.set(local,index+1);const mode=index===1||index===2?493:index>=8?384:420;modes.set(local,mode);
    return {path,sha256:sha(raw),bytes:raw.length,mode};
  });
  const stat=p=>{assert.ok(files.has(p)||dirs.has(p),'unexpected path '+p);const directory=dirs.has(p);return {dev:1,ino:inode.get(p)??90,size:files.get(p)?.length??0,mode:(directory?0o40000:0o100000)+(modes.get(p)??493),mtimeMs:1,ctimeMs:1,isDirectory:()=>directory,isFile:()=>!directory,isSymbolicLink:()=>false};};
  const fs={constants:{O_RDONLY:0,O_NOFOLLOW:131072},realpathSync:p=>p,lstatSync:stat,existsSync:p=>files.has(p)||dirs.has(p),
    readdirSync:p=>[...files.keys(),...dirs].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(k=>k.slice(p.length+1)),
    openSync(p,mode){assert.equal(mode,131072);assert.ok(files.has(p));const fd=next++;fds.set(fd,{path:p,offset:0});return fd;},fstatSync:fd=>stat(fds.get(fd).path),
    readSync(fd,b,offset,length){const f=fds.get(fd),raw=files.get(f.path),n=Math.min(length,raw.length-f.offset);raw.copy(b,offset,f.offset,f.offset+n);f.offset+=n;return n;},
    closeSync:fd=>assert.equal(fds.delete(fd),true),readFileSync:fd=>Buffer.from(files.get(typeof fd==='number'?fds.get(fd).path:fd)),
    writeFileSync(p,b,o){assert.equal(o.flag,'wx');assert.equal(files.has(p),false);files.set(p,Buffer.from(b));modes.set(p,o.mode);inode.set(p,next++);},
  };
  return {files,dirs,fds,inode,modes,fs,inventory,artifacts:{inventory,inventorySha256:sha(JSON.stringify(inventory))}};
}
function run(program,m,extra={}){
  const output=[],process={env:{},hrtime:{bigint:()=>0n},stdout:{write:s=>output.push(s)}};
  const result=new Script(program).runInNewContext({Buffer,URL,AbortSignal,process,fetch:extra.fetch,console:{log:s=>output.push(s),error:s=>output.push(s)},require:n=>{
    if(n==='node:fs')return m.fs;
    // Synthetic host filesystem arrays cross the VM boundary. Compare exact
    // JSON values in this fixture, not different realms' Array prototypes.
    if(n==='node:assert/strict')return Object.assign((...args)=>assert(...args),assert,{deepEqual:(a,b)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)))});
    if(n==='node:crypto')return {createHash};if(n==='node:path')return {resolve:p=>'/fixture/'+p};throw Error('forbidden synthetic operation '+n);
  },...extra},{timeout:3000});return {result,output,process};
}
test('fixed15 paths equal legacy runtime allowlist, bounded prospective identity is distinct and deterministic',()=>{
  assert.deepEqual(COMPACT_ARTIFACT_PATHS,NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS);
  const {old,full,compact}=fixture();assert.deepEqual(compact,assembleNativeCompactFinal(full));
  assert.notEqual(compact.planSha256,old.planSha256);assert.notEqual(compact.requestSha256,old.requestSha256);
  assert.match(compact.candidateImage,/:compact-final-[a-f0-9]{40}$/);
  assert.equal(compact.fullLocalCandidateImage,full.candidateImage);
  assert.equal(compact.identity.resources.operationSeconds,2445);assert.equal(compact.request.timeoutInMinutesOverride,45);
  assert.equal(compact.request.computeTypeOverride,'BUILD_GENERAL1_LARGE');assert.equal(compact.request.autoRetryLimitOverride,0);
  assert.equal(compact.identity.resources.memoryBytes,14*1024**3);assert.equal(compact.identity.resources.cpus,8);
  assert.ok(Buffer.byteLength(compact.request.buildspecOverride)<=25600);
  assert.equal(unpackFreshPrepareOperation(compact.transport),compact.operation);
  for(const key of Object.keys(flags))assert.equal(compact[key],false);
  assert.throws(()=>assembleNativeCompactFinal(old));
});
test('actual source inventory binds final proof and all original six ancestor receipt bytes before export',()=>{
  const {compact}=fixture(),m=memory(),parents=finalFixture().completedPhases.at(-1).completed.receiptChain;
  parents.forEach((r,index)=>m.files.set(COMPACT_ARTIFACT_PATHS[8+index],Buffer.from(r.base64,'base64')));
  const hashes=m.inventory.slice(0,8).map(e=>e.sha256),proof={packageSha256:hashes[0],'llvm-cpu-jit':hashes[1],'llvm-arm-policy':hashes[2],abiReceiptSha256:hashes[3],'llvm-abi.json':hashes[4],unitReceiptSha256:hashes[5],'llvm-release-configuration.json':hashes[6],'llvm-assertions-configuration.json':hashes[7]};
  const raw=Buffer.from(JSON.stringify({proof})+'\n');m.files.set(COMPACT_ARTIFACT_PATHS[14],raw);
  m.files.set(compact.externalDirectory+'/image-review.json',Buffer.from(JSON.stringify({finalReceiptBase64:raw.toString('base64'),review:{finalReceiptSha256:sha(raw)}})));
  run(compact.generatedPrograms.sourceInventory,m);
  const result=JSON.parse(m.files.get(compact.externalDirectory+'/compact-artifacts.json'));
  assert.equal(result.inventory.length,15);assert.equal(result.inventorySha256,sha(JSON.stringify(result.inventory)));
  parents.forEach((r,index)=>{assert.equal(result.inventory[8+index].sha256,r.sha256);assert.equal(result.inventory[8+index].bytes,Buffer.from(r.base64,'base64').length);});
  assert.equal(result.inventory[14].sha256,sha(raw));
  m.files.delete(compact.externalDirectory+'/compact-artifacts.json');m.files.set(COMPACT_ARTIFACT_PATHS[8],Buffer.from('changed original receipt'));
  assert.throws(()=>run(compact.generatedPrograms.sourceInventory,m));assert.equal(m.files.has(compact.externalDirectory+'/compact-artifacts.json'),false);
});
test('unchanged full recipe/pre/image guards precede compact build; only scratch is published and never started',()=>{
  const {full,compact}=fixture(),text=compact.operation;
  for(const key of ['bootstrapRecipe','bootstrapPre','containerGuardRecipe','stoppedContainerGuardRecipe','stoppedContainerGuardPre','containerGuardPre','containerGuardImage','admission','verificationAdmission','recipeCommitAdmission','imageGuard','recipeImageGuard','compare'])assert.equal(compact.generatedPrograms[key],full.generatedPrograms[key]);
  assert.ok(compact.generatedPrograms.bootstrapImage.includes("await runtime('image',c);"));
  assert.ok(text.indexOf(quote(full.generatedPrograms.compare))<text.indexOf('docker build'));
  assert.ok(text.includes('docker build --network=none --no-cache --platform linux/amd64'));
  assert.equal((text.match(/docker build /g)??[]).length,1);
  assert.ok(text.includes('FROM scratch'));assert.ok(text.includes('COPY build /build/'));
  assert.ok(!text.includes('docker push '+full.candidateImage));assert.ok(text.includes('180s docker push '+compact.candidateImage));
  assert.ok(!text.includes('docker start "$native_compact_id"'));assert.ok(text.includes('--entrypoint /never-executed'));
  assert.ok(text.includes('NATIVE_FRESH_COMPACT_FINAL_VERIFIED='));assert.ok(text.includes('NATIVE_FRESH_COMPACT_FINAL_CLEANED='));
  assert.ok(!text.includes('NATIVE_FRESH_FINAL_VERIFIED='));
  assert.match(compact.generatedPrograms.readCleanupIds,/\['image','pre','recipe','compact'\]/);
  assert.match(compact.generatedPrograms.cleanup,/ids.length<=2/);
});
test('actual aggregate admission uses original clock and refuses insufficient export/build/readback/push reserve',()=>{
  const {compact}=fixture(),m=memory();m.files.set('native-fresh-final-proof/clock.json',Buffer.from(JSON.stringify({deadlineNs:'925000000000'})));
  run(compact.generatedPrograms.compactAdmission,m);
  m.files.set('native-fresh-final-proof/clock.json',Buffer.from(JSON.stringify({deadlineNs:'924999999999'})));
  assert.throws(()=>run(compact.generatedPrograms.compactAdmission,m));
  m.files.set('native-fresh-final-proof/clock.json',Buffer.from(JSON.stringify({deadlineNs:'525000000000'})));
  run(compact.generatedPrograms.registryPushAdmission,m);
  m.files.set('native-fresh-final-proof/clock.json',Buffer.from(JSON.stringify({deadlineNs:'524999999999'})));
  assert.throws(()=>run(compact.generatedPrograms.registryPushAdmission,m));
});
test('every actual generated JavaScript program and complete operation passes syntax validation only',()=>{
  const {compact}=fixture();for(const[name,program]of Object.entries(compact.generatedPrograms))assert.doesNotThrow(()=>new Script(program),name);
  const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
  const prefix='timeout --signal=TERM --kill-after=75s 2445s bash -eu -o pipefail -c ';
  const quoted=compact.operation.slice(prefix.length),shell=quoted.slice(1,-1).replaceAll("'\\''","'");assert.equal(quote(shell),quoted);
  for(const script of [compact.operation,shell,...Object.values(compact.generatedCompactShells)]){
    const r=spawnSync(bash,['-n'],{input:script,encoding:'utf8',timeout:10000});
    assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
  }
});
test('actual committed readback inspects original15 copied from scratch, not only source context',()=>{
  const {compact}=fixture(),root='/fixture/native-fresh-final-proof/compact-readback/build',m=memory(root),prefix='native-fresh-final-proof/';
  m.dirs.add('/fixture/native-fresh-final-proof/compact-readback');
  m.files.set(prefix+'compact-artifacts.json',Buffer.from(JSON.stringify(m.artifacts)));
  m.files.set(prefix+'commit-id',Buffer.from('sha256:'+'e'.repeat(64)+'\n'));
  run(compact.generatedPrograms.committedReadback,m);
  const proof=JSON.parse(m.files.get(prefix+'compact-committed.json'));
  assert.equal(proof.fullLocalImageConfigDigest,'sha256:'+'e'.repeat(64));assert.equal(proof.committedCompactFilesVerified,true);assert.equal(proof.compactRootFsLayers,1);
  assert.deepEqual(proof.compactArtifacts,m.artifacts);
  const bad=memory(root);bad.dirs.add('/fixture/native-fresh-final-proof/compact-readback');
  bad.files.set(prefix+'compact-artifacts.json',Buffer.from(JSON.stringify(bad.artifacts)));bad.files.set(prefix+'commit-id',Buffer.from('sha256:'+'e'.repeat(64)));
  bad.files.set(root+'/other',Buffer.from('unadmitted'));
  assert.throws(()=>run(compact.generatedPrograms.committedReadback,bad));assert.equal(bad.files.has(prefix+'compact-committed.json'),false);
});
for(const phase of ['export','build','readback'])test('actual outer cleanup retains owned IDs during '+phase+' failure, never foreign IDs',()=>{
  const {compact}=fixture(),m=memory(),p='native-fresh-final-proof/',ids={recipe:'a'.repeat(64),pre:'b'.repeat(64),image:'c'.repeat(64),compact:'d'.repeat(64)};
  for(const name of ['recipe','pre','image',...(phase==='readback'?['compact']:[])])m.files.set(p+name+'-cid',Buffer.from(ids[name]));
  const done=phase==='export'?ids.recipe:[ids.recipe,ids.pre,ids.image].join(' ');
  const output=run(compact.generatedPrograms.readCleanupIds,m,{process:{env:{VAETTIR_FINAL_CLEANUP_DONE:done},stdout:{write:s=>m.cleanupOutput=s}}});assert.ok(output);
  const remaining=phase==='export'?[ids.image,ids.pre]:phase==='readback'?[ids.compact]:[];
  assert.deepEqual((m.cleanupOutput??'').split(' ').filter(Boolean),remaining);
  if(!remaining.length)return;
  m.files.set(p+'commit-id',Buffer.from('sha256:'+'e'.repeat(64)));m.files.set(p+'recipe-image-id',Buffer.from('sha256:'+'f'.repeat(64)));m.files.set(p+'compact-id',Buffer.from('sha256:'+'9'.repeat(64)));
  const record=id=>({Id:id,Image:id===ids.image?'sha256:'+'e'.repeat(64):id===ids.pre?'sha256:'+'f'.repeat(64):'sha256:'+'9'.repeat(64),Config:{Labels:{'vaettir.final-owner':compact.planSha256}},Mounts:[],State:{Running:false,Status:'created'},HostConfig:{NetworkMode:'none',Privileged:false,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],Memory:14*1024**3,NanoCpus:8000000000,PidsLimit:2048}});
  const inspected=remaining.map(record);m.files.set(p+'cleanup-inspect.json',Buffer.from(JSON.stringify(inspected)));
  const env={VAETTIR_FINAL_CLEANUP_IDS:remaining.join(' ')};run(compact.generatedPrograms.cleanup,m,{process:{env}});
  inspected[0].Config.Labels['vaettir.final-owner']='other owner';m.files.set(p+'cleanup-inspect.json',Buffer.from(JSON.stringify(inspected)));
  assert.throws(()=>run(compact.generatedPrograms.cleanup,m,{process:{env}}));
  inspected[0]=record(remaining[0]);inspected.push(inspected[0]);m.files.set(p+'cleanup-inspect.json',Buffer.from(JSON.stringify(inspected)));
  assert.throws(()=>run(compact.generatedPrograms.cleanup,m,{process:{env}}));
  if(phase==='readback'){inspected.pop();inspected[0].State.Status='exited';m.files.set(p+'cleanup-inspect.json',Buffer.from(JSON.stringify(inspected)));assert.throws(()=>run(compact.generatedPrograms.cleanup,m,{process:{env}}));}
  if(phase==='export'){m.files.set(p+'image-cid',Buffer.from(ids.pre));assert.throws(()=>run(compact.generatedPrograms.readCleanupIds,m,{process:{env:{VAETTIR_FINAL_CLEANUP_DONE:done},stdout:{write:()=>{}}}}));}
});
test('actual scratch admission refuses a started, foreign, networked or mounted inspection container',()=>{
  const {compact}=fixture(),m=memory(),p='native-fresh-final-proof/',id='d'.repeat(64),image='sha256:'+'9'.repeat(64);
  m.files.set(p+'compact-cid',Buffer.from(id));m.files.set(p+'compact-id',Buffer.from(image));
  const good={Id:id,Image:image,Config:{Labels:{'vaettir.final-owner':compact.planSha256}},Mounts:[],State:{Running:false,Status:'created'},HostConfig:{NetworkMode:'none',Privileged:false,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],Memory:14*1024**3,NanoCpus:8000000000,PidsLimit:2048}};
  const write=v=>m.files.set(p+'compact-inspect.json',Buffer.from(JSON.stringify([v])));write(good);run(compact.generatedPrograms.scratchGuard,m);
  for(const change of [v=>v.State.Running=true,v=>v.State.Status='exited',v=>v.Image='sha256:'+'8'.repeat(64),v=>v.Config.Labels['vaettir.final-owner']='foreign',v=>v.HostConfig.NetworkMode='bridge',v=>v.Mounts.push({source:'private'}),v=>v.HostConfig.Privileged=true]){
    const bad=structuredClone(good);change(bad);write(bad);assert.throws(()=>run(compact.generatedPrograms.scratchGuard,m));
  }
});
test('actual file inspector retains byte/mode/order proof across different inode identities',()=>{
  const source=memory(),copy=memory('/copy/build');for(const[k,v]of copy.inode)copy.inode.set(k,v+1000);
  const hashes=source.inventory.map(e=>e.sha256);
  assert.deepEqual(inspectCompactArtifactFiles(source.fs,'/build',COMPACT_ARTIFACT_PATHS,hashes,null,false,createHash,assert),source.artifacts);
  assert.deepEqual(inspectCompactArtifactFiles(copy.fs,'/copy/build',COMPACT_ARTIFACT_PATHS,hashes,source.inventory,true,createHash,assert),source.artifacts);
  assert.equal(source.fds.size,0);assert.equal(copy.fds.size,0);
});
for(const attack of ['extra file','extra receipt','wrong bytes','wrong mode','symlink','changing inode','oversize','missing path'])test('actual copied-file guard refuses '+attack,()=>{
  const m=memory('/copy/build'),target='/copy/build/llvm-cpu-jit';
  if(attack==='extra file')m.files.set('/copy/build/secret',Buffer.from('not admitted'));
  if(attack==='extra receipt')m.files.set('/copy/build/llvm-phase-receipts/other.json',Buffer.from('not admitted'));
  if(attack==='wrong bytes')m.files.set(target,Buffer.from('changed'));
  if(attack==='wrong mode')m.modes.set(target,420);
  if(attack==='symlink'){const old=m.fs.lstatSync;m.fs.lstatSync=p=>p===target?{...old(p),isSymbolicLink:()=>true}:old(p);}
  if(attack==='changing inode'){const read=m.fs.readSync;m.fs.readSync=(...args)=>{const n=read(...args),p=m.fds.get(args[0]).path;m.inode.set(p,m.inode.get(p)+100);return n;};}
  if(attack==='oversize'){const old=m.fs.lstatSync;m.fs.lstatSync=p=>p===target?{...old(p),size:128*1024**2+1}:old(p);}
  if(attack==='missing path')m.files.delete(target);
  assert.throws(()=>inspectCompactArtifactFiles(m.fs,'/copy/build',COMPACT_ARTIFACT_PATHS,m.inventory.map(e=>e.sha256),m.inventory,true,createHash,assert));assert.equal(m.fds.size,0);
});
