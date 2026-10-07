// Explicitly synthetic in-memory runner/guard models. No native /build filesystem,
// compiler/unit/package execution, Docker, AWS, donor or release acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {execFileSync} from 'node:child_process';
import * as original from './native-builder-fresh-final-plan.mjs';
import * as v2 from './native-packaging-v2-builder-fresh-final-plan.mjs';
import {finalFixture} from './native-final-runtime-recipe-fixture.mjs';
import {nativeValidationShell} from './native-builder-recovery.mjs';
import {unpackFreshPrepareOperation} from './native-packaging-v2-builder-fresh-prepare.mjs';
import {createNativeFreshFinalAdapter} from './native-builder-fresh-final-adapter.mjs';
import {gzipSync} from 'node:zlib';
import {reviewedRecipeIsolationTestOverlay} from './native-final-recipe-isolation-test-overlay.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const gb=1024**3, prefix='native-fresh-final-proof/';
const bashPath=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
const preparedPlans=new Map();
function planFor(module){
 if(preparedPlans.has(module))return preparedPlans.get(module);
 const input=finalFixture();
 if(module===original){const result={input,plan:module.planNativeFreshFinal(input)};preparedPlans.set(module,result);return result;}
 // Actual V2 assembly, explicitly supplied synthetic V1-derived identity.
 // This does NOT claim accepted V2 parent/native lineage. Root's separate
 // complete derivation/fixture suites cover those independent contracts.
 const identity={...original.planNativeFreshFinal(input).identity,purpose:'native-packaging-v2-fresh-final-plan-not-runtime'};
 const source=readFileSync(new URL('./native-packaging-v2-builder-fresh-final-plan.mjs',import.meta.url),'utf8');
 const start=source.indexOf('function assemble(identity) {');assert.ok(start>=0);
 const sandbox={Buffer,TextDecoder,assert,gzipSync,sha,quote,nativeValidationShell,unpackFreshPrepareOperation,nativeFinalPublicFailure:module.nativeFinalPublicFailure,
  repository:'051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api',bucket:'vaettir-build-source-051722405355',flags:{unitAcceptance:false,packageAcceptance:false,runtimeAcceptance:false,authenticatedAcceptance:false,deploymentAcceptance:false}};
 const actual=new Script(source.slice(start)+'\nassemble').runInNewContext(sandbox,{timeout:2000});const result={input,plan:actual(identity)};preparedPlans.set(module,result);return result;
}
function memoryFilesystem(initial={}){
 const files=new Map(Object.entries(initial).map(([p,b])=>[p,Buffer.isBuffer(b)?Buffer.from(b):Buffer.from(b)]));
 const dirs=new Set(['/','/tmp','/build','/build/scripts','/build/llvm-phase-receipts']),fds=new Map(),writes=[];let fdNext=1,stdin=Buffer.alloc(0),stdinOffset=0;
 const ino=p=>[...files.keys(),...dirs].indexOf(p)+1;
 const stat=p=>{assert.ok(files.has(p)||dirs.has(p),'Unexpected synthetic path '+p);const directory=dirs.has(p);return {dev:1,ino:ino(p),mode:directory?0o40755:0o100644,uid:0,size:files.get(p)?.length??0,mtimeMs:1,ctimeMs:1,isFile:()=>!directory,isDirectory:()=>directory,isSymbolicLink:()=>false};};
 const fs={constants:{O_RDONLY:0,O_NOFOLLOW:131072},existsSync:p=>files.has(p)||dirs.has(p),realpathSync:p=>p,lstatSync:stat,
  openSync(p,flags){assert.equal(flags,131072);assert.ok(files.has(p));const fd=fdNext++;fds.set(fd,{path:p,offset:0});return fd;},
  fstatSync:fd=>stat(fds.get(fd).path),closeSync:fd=>assert.equal(fds.delete(fd),true),
  readFileSync:p=>{const raw=files.get(typeof p==='number'?fds.get(p).path:p);assert.ok(raw);return Buffer.from(raw);},
  readSync(fd,target,offset,length){if(fd===0){const n=Math.min(length,stdin.length-stdinOffset);stdin.copy(target,offset,stdinOffset,stdinOffset+n);stdinOffset+=n;return n;}const f=fds.get(fd),raw=files.get(f.path),n=Math.min(length,raw.length-f.offset);raw.copy(target,offset,f.offset,f.offset+n);f.offset+=n;return n;},
  mkdirSync(p,{mode}){assert.equal(mode,0o700);assert.equal(dirs.has(p),false);dirs.add(p);},
  writeFileSync(p,value,options){assert.equal(options.flag,'wx');assert.equal(files.has(p),false);files.set(p,Buffer.from(value));writes.push(p);},
 };
 return {files,dirs,fds,writes,fs,stat,setStdin:b=>{stdin=Buffer.from(b);stdinOffset=0;}};
}
function runnerHarness(module,plan,options={}){
 const capsule=JSON.parse(planFor(module).input.capsule.bytes),dir=plan.externalDirectory;
 const finalRaw=Buffer.from(JSON.stringify({phase:'final',predecessorSha256:plan.identity.expectedParent.receiptSha256,inputsSha256:plan.identity.inputsSha256,proof:{'llvm-arm-policy':'b'.repeat(64),'llvm-cpu-jit':'c'.repeat(64)}})+'\n');
 const rawLog=Buffer.from('synthetic full original recipe stdout bytes\r\n');
 const control={planSha256:plan.planSha256,externalDirectory:dir,sourceCommit:plan.identity.sourceCommit,sourceSha256:plan.identity.sourceSha256,inputsSha256:plan.identity.inputsSha256,inputs:plan.identity.inputs,scriptPins:plan.identity.scriptPins,sourceManifestSha256:plan.identity.sourceManifestSha256,receipts:plan.identity.receipts,parentReceiptSha256:plan.identity.expectedParent.receiptSha256,coreCandidateSha256:plan.identity.coreCandidateSha256,coreAbiReceiptSha256:plan.identity.coreAbiReceiptSha256,recipeSeconds:1200,verificationReserveSeconds:900,capsuleMembers:plan.identity.capsule.members,deadlineNs:'2445000000000'};
 const initial=Object.fromEntries(Object.entries(capsule.members).map(([n,m])=>[dir+'/'+n,Buffer.from(m.base64,'base64')]));
 const mem=memoryFilesystem(initial);mem.dirs.add(dir);const calls=[],logs=[],adapterOptions=[],verifierInputs=[];
 const spawn=(command,args,settings)=>{
  calls.push('recipe');assert.equal(command,'/bin/bash');assert.deepEqual(Array.from(args.slice(0,4)),['-eu','-o','pipefail','-c']);
  assert.ok(args[4].startsWith('sh -x /build/scripts/build-llvm-runtime.sh --phase final --predecessor-sha256 '+control.parentReceiptSha256+' 2>&1 | '));assert.ok(args[4].includes('ulimit -f 16384; exec tee '+dir+'/final.log'));
  assert.equal(settings.timeout,1200000);assert.equal(settings.env.PYTHONDONTWRITEBYTECODE,'1');
  if(!options.recipeFailure){mem.files.set(dir+'/final.log',Buffer.from(rawLog));mem.files.set('/build/llvm-phase-receipts/final.json',Buffer.from(finalRaw));}
  if(options.recipeSpentNs!==undefined)process.hrtime.bigint=()=>BigInt(options.recipeSpentNs);
  return {error:undefined,signal:null,status:options.recipeFailure?1:0};
 };
 const adapter={ops:{syntheticOnly:true},provenance:{memoryLimitBytes:14*gb,runtimeAcceptance:false,authenticatedAcceptance:false,deploymentAcceptance:false},cleanupOwnedExtraction(){calls.push('cleanup');if(options.cleanupFailure)throw new Error('synthetic cleanup refusal');}};
 const fakeImport=async name=>{
  if(name==='node:fs')return mem.fs;if(name==='node:perf_hooks')return {performance:{now:()=>0}};if(name==='node:assert/strict')return {default:assert};if(name==='node:crypto')return {createHash};if(name==='node:child_process')return {spawnSync:spawn};
  if(name.endsWith('/native-builder-fresh-final-adapter.mjs'))return {async createNativeFreshFinalAdapter(value){calls.push('adapter');adapterOptions.push(value);if(options.lowMemory)return createNativeFreshFinalAdapter(value,{fs:mem.fs,exec(){throw Error('No synthetic/native exec');},importExact(){throw Error('No import after failed admission');},clock:()=>0,platform:()=> 'linux',uid:()=>0,memory:()=>({limit:14*gb,used:12*gb+1})});if(options.adapterFailure)throw Error('synthetic adapter failure');return adapter;}};
  if(name.endsWith('/native-builder-fresh-final-verifier.mjs'))return {verifyNativeFreshFinalState(value,ops){calls.push('verifier');verifierInputs.push(value);assert.equal(ops,adapter.ops);if(options.verifierFailure)throw Error('synthetic verifier failure');return {completeInputsAndObjectsRecomputed:true,finalReceiptSha256:sha(finalRaw),finalLogSha256:sha(rawLog),runtimeAcceptance:false,authenticatedAcceptance:false,deploymentAcceptance:false};}};
  if(name.endsWith('/native-fresh-final-transport.mjs'))return {encodeNativeFreshFinalLog:module.encodeNativeFreshFinalLog};
  throw Error('Unexpected synthetic import '+name);
 };
 const raw=Buffer.from(capsule.members['native-fresh-final-runner.mjs'].base64,'base64').toString();
 const source=raw.replace('export async function runtime','async function runtime').replaceAll(/\bimport\(/g,'fakeImport(');
 const controlBytes=Buffer.from(JSON.stringify(control));mem.files.set(dir+'/control.json',controlBytes);
 const process={env:{PYTHONDONTWRITEBYTECODE:'1',VAETTIR_FINAL_CONTROL_SHA:sha(controlBytes)},hrtime:{bigint:()=>BigInt(options.nowNs??0)}};
 const sandbox={fakeImport,Buffer,TextDecoder,process,console:{log:s=>logs.push(s),error:s=>logs.push(s)}};
 const actual=new Script(source+'\nruntime').runInNewContext(sandbox,{timeout:2000});
 return {...mem,control,finalRaw,rawLog,dir,calls,logs,adapterOptions,verifierInputs,process,run:stage=>actual(stage,control)};
}
function guardHarness(initial){
 const mem=memoryFilesystem(initial),stdout=[],process={env:{},stdout:{write:s=>stdout.push(s)},hrtime:{bigint:()=>1000000000n}};
 const sandbox={Buffer,TextDecoder,URL,AbortSignal,process,console:{log:s=>stdout.push(s),error:s=>stdout.push(s)},require:n=>{if(n==='node:fs')return mem.fs;if(n==='node:assert/strict')return assert;if(n==='node:crypto')return {createHash};throw Error('No synthetic subprocess/other builtin '+n);}};
 return {...mem,stdout,process,run:source=>new Script(source).runInNewContext(sandbox,{timeout:2000})};
}
function transplant(from,to){for(const[p,b]of from.files)to.files.set(p,Buffer.from(b));for(const p of from.dirs)to.dirs.add(p);}
const nativeRefusal=h=>{assert.equal(h.logs.some(s=>s.startsWith('NATIVE_FRESH_FINAL_REVIEW=')),false);assert.equal(h.verifierInputs.length,0);assert.equal(h.fds.size,0);};
function decodedShell(operation){const prefix='timeout --signal=TERM --kill-after=75s 2445s bash -eu -o pipefail -c ';assert.ok(operation.startsWith(prefix));const quoted=operation.slice(prefix.length);assert.ok(quoted.startsWith("'")&&quoted.endsWith("'"));const script=quoted.slice(1,-1).replaceAll("'\\''","'");assert.equal(quote(script),quoted);return script;}
for(const [name,module]of [['original',original],['packaging-v2',v2]]){
 test(name+': recipe-only stage preserves exact command/log/receipt/capsule without adapter imports or review',async()=>{
  const {plan}=planFor(module),h=runnerHarness(module,plan);await h.run('recipe');assert.deepEqual(h.calls,['recipe']);assert.equal(h.logs.length,0);assert.equal(h.fds.size,0);
  assert.deepEqual(h.files.get(h.dir+'/final.log'),h.rawLog);assert.deepEqual(h.files.get('/build/llvm-phase-receipts/final.json'),h.finalRaw);
  assert.deepEqual(JSON.parse(h.files.get(h.dir+'/recipe-handoff.json')),{stage:'recipe-unverified',planSha256:plan.planSha256,controlSha256:h.process.env.VAETTIR_FINAL_CONTROL_SHA,deadlineNs:h.control.deadlineNs,finalLogSha256:sha(h.rawLog),finalReceiptSha256:sha(h.finalRaw),runtimeAcceptance:false,authenticatedAcceptance:false,deploymentAcceptance:false});
  assert.deepEqual(h.writes,[h.dir+'/recipe-handoff.json']);assert.equal(h.files.has(h.dir+'/pre-review.json'),false);
 });
 test(name+': fresh pre and final-image stages do not rerun recipe and both invoke unchanged full verifier inputs',async()=>{
  const {plan}=planFor(module),recipe=runnerHarness(module,plan);await recipe.run('recipe');
  const pre=runnerHarness(module,plan);transplant(recipe,pre);await pre.run('pre');assert.deepEqual(pre.calls,['adapter','verifier','cleanup']);
  const image=runnerHarness(module,plan);transplant(pre,image);await image.run('image');assert.deepEqual(image.calls,['adapter','verifier','cleanup']);
  for(const h of [pre,image]){
   assert.equal(h.control.deadlineNs,recipe.control.deadlineNs);assert.equal(h.adapterOptions.length,1);assert.equal(h.adapterOptions[0].memoryLimitBytes,14*gb);assert.equal(h.adapterOptions[0].exclusiveWriter,true);assert.equal(h.adapterOptions[0].cleanupDeadlineMs-h.adapterOptions[0].deadlineMs,75000);assert.deepEqual(h.adapterOptions[0].finalLog,recipe.rawLog);
   const input=JSON.parse(JSON.stringify(h.verifierInputs[0]));assert.equal(input.sourceCommit,plan.identity.sourceCommit);assert.equal(input.sourceSha256,plan.identity.sourceSha256);assert.deepEqual(input.inputs,plan.identity.inputs);assert.deepEqual(input.scriptPins,plan.identity.scriptPins);assert.equal(input.sourceManifestSha256,plan.identity.sourceManifestSha256);assert.equal(input.coreCandidateSha256,plan.identity.coreCandidateSha256);assert.equal(input.coreAbiReceiptSha256,plan.identity.coreAbiReceiptSha256);assert.deepEqual(input.receipts,[...plan.identity.receipts,{phase:'final',sha256:sha(recipe.finalRaw)}]);assert.equal(input.finalLogSha256,sha(recipe.rawLog));assert.equal(h.fds.size,0);
  }
  const reviews=[...pre.logs,...image.logs].filter(s=>s.startsWith('NATIVE_FRESH_FINAL_REVIEW='));assert.equal(reviews.length,2);const values=reviews.map(s=>JSON.parse(s.slice('NATIVE_FRESH_FINAL_REVIEW='.length)));assert.equal(values[0].stage,'pre');assert.equal(values[1].stage,'image');assert.equal(values[0].finalReceiptBase64,recipe.finalRaw.toString('base64'));assert.equal(values[0].finalReceiptBase64,values[1].finalReceiptBase64);assert.deepEqual(values[0].review,values[1].review);
  const chunks=pre.logs.filter(s=>s.startsWith('NATIVE_FRESH_FINAL_LOG_CHUNK='));assert.deepEqual(module.reassembleNativeFreshFinalLog(chunks,{planSha256:plan.planSha256,phase:'final',phaseLogSha256:sha(recipe.rawLog)}).bytes,recipe.rawLog);assert.equal(image.logs.some(s=>s.startsWith('NATIVE_FRESH_FINAL_LOG_CHUNK=')),false);
 });
 test(name+': mutated handoff/log/receipt/capsule or absent handoff refuses before adapter/verifier publication',async()=>{
  const {plan}=planFor(module),recipe=runnerHarness(module,plan);await recipe.run('recipe');
  const changes=[h=>h.files.delete(h.dir+'/recipe-handoff.json'),h=>{const b=Buffer.from(h.files.get(h.dir+'/final.log'));b[0]^=1;h.files.set(h.dir+'/final.log',b);},h=>{const raw=JSON.parse(h.finalRaw);raw.inputsSha256='f'.repeat(64);h.files.set('/build/llvm-phase-receipts/final.json',Buffer.from(JSON.stringify(raw)));},h=>{const b=Buffer.from(h.files.get(h.dir+'/native-builder-fresh-final-adapter.mjs'));b[0]^=1;h.files.set(h.dir+'/native-builder-fresh-final-adapter.mjs',b);}];
  for(const field of ['stage','planSha256','controlSha256','deadlineNs','finalLogSha256','finalReceiptSha256','runtimeAcceptance','authenticatedAcceptance','deploymentAcceptance'])changes.push(h=>{const value=JSON.parse(h.files.get(h.dir+'/recipe-handoff.json'));value[field]=typeof value[field]==='boolean'?true:'wrong';h.files.set(h.dir+'/recipe-handoff.json',Buffer.from(JSON.stringify(value)));});
  changes.push(h=>{const value=JSON.parse(h.files.get(h.dir+'/recipe-handoff.json'));value.extra=true;h.files.set(h.dir+'/recipe-handoff.json',Buffer.from(JSON.stringify(value)));});
  for(const change of changes){const h=runnerHarness(module,plan);transplant(recipe,h);change(h);await assert.rejects(h.run('pre'));nativeRefusal(h);assert.equal(h.calls.includes('recipe'),false);assert.equal(h.calls.includes('adapter'),false);}
 });
 test(name+': recipe failure/active phase/deadline reserve retain refusal with no unverified handoff',async()=>{
  const {plan}=planFor(module);
  for(const options of [{recipeFailure:true},{nowNs:2445000000000n},{nowNs:400000000000n},{recipeSpentNs:1600000000000n}]){const h=runnerHarness(module,plan,options);await assert.rejects(h.run('recipe'));nativeRefusal(h);assert.equal(h.files.has(h.dir+'/recipe-handoff.json'),false);}
  const active=runnerHarness(module,plan);active.files.set('/build/llvm-phase-active.json',Buffer.from('{}'));await assert.rejects(active.run('recipe'));nativeRefusal(active);assert.equal(active.files.has(active.dir+'/recipe-handoff.json'),false);
 });
 test(name+': actual adapter still rejects one byte below two-GiB headroom before verifier, no subtraction/bypass',async()=>{
  const {plan}=planFor(module),recipe=runnerHarness(module,plan);await recipe.run('recipe');const h=runnerHarness(module,plan,{lowMemory:true});transplant(recipe,h);
  await assert.rejects(h.run('pre'),error=>{assert.equal(error.nativeFinalAdapterCheck,'memory-headroom');assert.deepEqual(error.nativeFinalMemoryObservation,{limitBytes:14*gb,usedBytes:12*gb+1,configuredLimitBytes:14*gb});return true;});assert.deepEqual(h.calls,['adapter']);nativeRefusal(h);
 });
 test(name+': verifier or extraction cleanup failure cannot create either successful review',async()=>{
  const {plan}=planFor(module),recipe=runnerHarness(module,plan);await recipe.run('recipe');
  for(const options of [{adapterFailure:true},{verifierFailure:true},{cleanupFailure:true}]){const h=runnerHarness(module,plan,options);transplant(recipe,h);await assert.rejects(h.run('pre'));assert.equal(h.logs.some(s=>s.startsWith('NATIVE_FRESH_FINAL_REVIEW=')),false);assert.equal(h.files.has(h.dir+'/pre-review.json'),false);if(!options.adapterFailure)assert.deepEqual(h.calls,['adapter','verifier','cleanup']);}
 });
 test(name+': generated stopped owned containers bind original/intermediate/final identities and identical isolation',()=>{
  const {plan}=planFor(module),control='a'.repeat(64),intermediate='sha256:'+'d'.repeat(64),final='sha256:'+'f'.repeat(64);
  for(const stage of ['recipe','pre','image']){
   const record={Id:({recipe:'a',pre:'b',image:'c'})[stage].repeat(64),Image:stage==='recipe'?plan.identity.expectedParent.imageConfigDigest:stage==='pre'?intermediate:final,Config:{Labels:{'vaettir.final-owner':plan.planSha256},Env:['PYTHONDONTWRITEBYTECODE=1','VAETTIR_FINAL_CONTROL_SHA='+control]},HostConfig:{NetworkMode:'none',Privileged:false,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],Memory:14*gb,NanoCpus:8000000000,PidsLimit:2048},Mounts:[],State:{Running:false,Status:'exited',ExitCode:0}};
   const initial={[prefix+stage+'-cid']:record.Id,[prefix+stage+'-inspect.json']:JSON.stringify([record]),[prefix+'control-sha']:control,[prefix+'recipe-image-id']:intermediate,[prefix+'commit-id']:final};
   const key=stage==='recipe'?'stoppedContainerGuardRecipe':stage==='pre'?'stoppedContainerGuardPre':'containerGuardImage';guardHarness(initial).run(plan.generatedPrograms[key]);
   for(const change of [r=>r.Id='e'.repeat(64),r=>r.Image='sha256:'+'e'.repeat(64),r=>r.Config.Labels['vaettir.final-owner']='e'.repeat(64),r=>r.Config.Env.push('VAETTIR_FINAL_CONTROL_SHA='+control),r=>r.Config.Env[1]='VAETTIR_FINAL_CONTROL_SHA='+'b'.repeat(64),r=>r.Config.Env[0]='PYTHONDONTWRITEBYTECODE=0',r=>r.HostConfig.Memory=12*gb,r=>r.HostConfig.NanoCpus=2000000000,r=>r.HostConfig.NetworkMode='default',r=>r.HostConfig.Privileged=true,r=>r.HostConfig.CapDrop=[],r=>r.HostConfig.SecurityOpt=[],r=>r.HostConfig.PidsLimit=4096,r=>r.Mounts=[{Type:'bind'}],...(stage==='image'?[]:[r=>r.State.Running=true,r=>r.State.Status='running',r=>r.State.ExitCode=1])]){const bad=structuredClone(record);change(bad);assert.throws(()=>guardHarness({...initial,[prefix+stage+'-inspect.json']:JSON.stringify([bad])}).run(plan.generatedPrograms[key]));}
  }
 });
 test(name+': actual local unverified image guard refuses source/rootfs/control/deadline/false-flag drift',()=>{
  const {plan}=planFor(module),id='sha256:'+'d'.repeat(64),control='a'.repeat(64),parent={Id:plan.identity.expectedParent.imageConfigDigest,RootFS:{Type:'layers',Layers:['sha256:'+'b'.repeat(64)]}},handoff={stage:'recipe-unverified',planSha256:plan.planSha256,controlSha256:control,deadlineNs:'2445000000000',finalLogSha256:'b'.repeat(64),finalReceiptSha256:'c'.repeat(64),runtimeAcceptance:false,authenticatedAcceptance:false,deploymentAcceptance:false};
  const image={Id:id,Os:'linux',Architecture:'amd64',Size:1024,RootFS:{Type:'layers',Layers:[...parent.RootFS.Layers,'sha256:'+'c'.repeat(64)]},Config:{Env:['PYTHONDONTWRITEBYTECODE=1','VAETTIR_FINAL_CONTROL_SHA='+control],Labels:{'vaettir.source-commit':plan.identity.sourceCommit,'vaettir.source-sha256':plan.identity.sourceSha256,'vaettir.prepare-plan':plan.identity.preparePlanSha256,'vaettir.continuation-plan':plan.planSha256,'vaettir.continuation-phase':'final-recipe-unverified','vaettir.runtime-eligible':'false','vaettir.artifact-purpose':'llvm-builder-checkpoint','vaettir.final-owner':plan.planSha256}}};
  const initial=()=>({[prefix+'recipe-image-id']:id,[prefix+'recipe-image-inspect.json']:JSON.stringify([image]),[prefix+'parent-inspect.json']:JSON.stringify([parent]),[prefix+'control-sha']:control,[prefix+'recipe-handoff.json']:JSON.stringify(handoff),[prefix+'capsule/control.json']:JSON.stringify({deadlineNs:handoff.deadlineNs})});
  guardHarness(initial()).run(plan.generatedPrograms.recipeImageGuard);
  for(const change of [i=>i.Id='sha256:'+'e'.repeat(64),i=>i.Os='other',i=>i.Architecture='arm64',i=>i.Size=0,i=>i.RootFS.Type='other',i=>i.RootFS.Layers.push('sha256:'+'d'.repeat(64)),i=>i.RootFS.Layers[0]='sha256:'+'e'.repeat(64),i=>i.Config.Labels['vaettir.source-commit']='f'.repeat(40),i=>i.Config.Labels['vaettir.source-sha256']='f'.repeat(64),i=>i.Config.Labels['vaettir.continuation-plan']='f'.repeat(64),i=>i.Config.Labels['vaettir.continuation-phase']='final',i=>i.Config.Labels['vaettir.runtime-eligible']='true',i=>i.Config.Labels['vaettir.artifact-purpose']='runtime',i=>i.Config.Labels['vaettir.final-owner']='f'.repeat(64),i=>i.Config.Env[1]='VAETTIR_FINAL_CONTROL_SHA='+'f'.repeat(64)]){const changed=structuredClone(image);change(changed);assert.throws(()=>guardHarness({...initial(),[prefix+'recipe-image-inspect.json']:JSON.stringify([changed])}).run(plan.generatedPrograms.recipeImageGuard));}
  for(const change of [h=>h.stage='pre',h=>h.planSha256='f'.repeat(64),h=>h.controlSha256='f'.repeat(64),h=>h.deadlineNs='1',h=>h.finalLogSha256='not-hash',h=>h.finalReceiptSha256='not-hash',h=>h.runtimeAcceptance=true,h=>h.authenticatedAcceptance=true,h=>h.deploymentAcceptance=true,h=>h.extra=true]){const changed=structuredClone(handoff);change(changed);assert.throws(()=>guardHarness({...initial(),[prefix+'recipe-handoff.json']:JSON.stringify(changed)}).run(plan.generatedPrograms.recipeImageGuard));}
 });
 test(name+': unresolved owned cleanup stays at most two IDs, role-bound images, recipe removal consumed before pre',()=>{
  const {plan}=planFor(module),recipe='a'.repeat(64),pre='b'.repeat(64),image='c'.repeat(64),intermediate='sha256:'+'d'.repeat(64),final='sha256:'+'f'.repeat(64);
  const initial={[prefix+'recipe-cid']:recipe,[prefix+'pre-cid']:pre,[prefix+'image-cid']:image,[prefix+'recipe-image-id']:intermediate,[prefix+'commit-id']:final};
  const unresolved=guardHarness(initial);unresolved.process.env.VAETTIR_FINAL_CLEANUP_DONE=recipe;unresolved.run(plan.generatedPrograms.readCleanupIds);assert.equal(unresolved.stdout.join(''),image+' '+pre);
  const records=[{Id:pre,Image:intermediate,Config:{Labels:{'vaettir.final-owner':plan.planSha256}},Mounts:[]},{Id:image,Image:final,Config:{Labels:{'vaettir.final-owner':plan.planSha256}},Mounts:[]}];
  const good=guardHarness({...initial,[prefix+'cleanup-inspect.json']:JSON.stringify(records)});good.process.env.VAETTIR_FINAL_CLEANUP_IDS=pre+' '+image;good.run(plan.generatedPrograms.cleanup);
  for(const change of [r=>r[0].Id=recipe,r=>r[0].Image=plan.identity.expectedParent.imageConfigDigest,r=>r[0].Config.Labels['vaettir.final-owner']='other',r=>r[0].Mounts=[{}]]){const changed=structuredClone(records);change(changed);const bad=guardHarness({...initial,[prefix+'cleanup-inspect.json']:JSON.stringify(changed)});bad.process.env.VAETTIR_FINAL_CLEANUP_IDS=pre+' '+image;assert.throws(()=>bad.run(plan.generatedPrograms.cleanup));}
  const three=guardHarness({...initial,[prefix+'cleanup-inspect.json']:JSON.stringify([...records,{Id:recipe,Image:plan.identity.expectedParent.imageConfigDigest,Config:{Labels:{'vaettir.final-owner':plan.planSha256}},Mounts:[]}])});three.process.env.VAETTIR_FINAL_CLEANUP_IDS=recipe+' '+pre+' '+image;assert.throws(()=>three.run(plan.generatedPrograms.cleanup));
 });
 test(name+': resource/deadline/command/buildspec bounds and all generated Node/Bash syntax remain',()=>{
  const {plan}=planFor(module);assert.equal(plan.identity.resources.memoryBytes,14*gb);assert.equal(plan.identity.resources.cpus,8);assert.equal(plan.identity.resources.compilerJobs,5);assert.equal(plan.identity.resources.recipeSeconds,1200);assert.equal(plan.identity.resources.verificationReserveSeconds,900);assert.equal(plan.identity.resources.operationSeconds,2445);assert.equal(plan.identity.resources.cleanupGraceSeconds,75);assert.equal(plan.identity.resources.decoderWatchdogSeconds,2550);assert.equal(plan.identity.resources.minimumDiskAvailableBytes,72*gb);assert.equal(plan.request.timeoutInMinutesOverride,45);assert.equal(plan.request.autoRetryLimitOverride,0);assert.equal(plan.identity.receipts.length,6);
  for(const code of Object.values(plan.generatedPrograms))new Script(code);assert.equal(Object.keys(plan.generatedPrograms).length,21);assert.ok(Buffer.byteLength(plan.request.buildspecOverride)<=25600);assert.ok(Buffer.byteLength(JSON.stringify(plan.request))+256<=30000);
  execFileSync(bashPath,['--noprofile','--norc','-n'],{input:plan.operation,windowsHide:true,timeout:10000,stdio:['pipe','pipe','pipe']});
  const remaining=guardHarness({[prefix+'clock.json']:JSON.stringify({deadlineNs:'901000000000'})});remaining.run(plan.generatedPrograms.verificationAdmission);remaining.files.set(prefix+'clock.json',Buffer.from(JSON.stringify({deadlineNs:'900999999999'})));assert.throws(()=>remaining.run(plan.generatedPrograms.verificationAdmission));
  const script=decodedShell(plan.operation);
  const commit=script.indexOf('>native-fresh-final-proof/recipe-image-id'),create=script.indexOf('--cidfile native-fresh-final-proof/pre-cid');assert.ok(commit>=0&&create>commit);assert.ok(script.slice(commit,create).includes('\ncleanup_native_validation\n'));assert.ok(script.slice(commit,create).includes(quote(plan.generatedPrograms.verificationAdmission)));assert.ok(script.includes('timeout 20s docker rm -f $native_final_ids'));assert.equal((script.match(/docker push /g)||[]).length,1);assert.equal(script.includes('docker push "$native_final_recipe_image"'),false);assert.equal(script.includes('drop_caches'),false);
 });
 test(name+': actual bootstrap materializes recipe capsule once; pre imports retained exact control/members without source injection',async()=>{
  const {plan,input}=planFor(module),mem=memoryFilesystem(),calls=[],logs=[],control=Buffer.from(JSON.stringify({planSha256:plan.planSha256,deadlineNs:'2445000000000'}));mem.setStdin(Buffer.from(JSON.stringify({capsuleBase64:input.capsule.bytes.toString('base64'),controlBase64:control.toString('base64')})));
  const proc={env:{PYTHONDONTWRITEBYTECODE:'1',VAETTIR_FINAL_CONTROL_SHA:sha(control)},exitCode:undefined};
  const sandbox={Buffer,process:proc,console:{error:s=>logs.push(s)},require:n=>n==='node:fs'?mem.fs:n==='node:crypto'?{createHash}:n==='node:assert/strict'?assert:assert.fail('Unexpected synthetic require'),fakeImport:async p=>{assert.equal(p,plan.externalDirectory+'/native-fresh-final-runner.mjs');return {runtime:async(stage,c)=>calls.push({stage,control:JSON.parse(JSON.stringify(c))})};}};
  // Each bootstrap is a fresh Node process/context over retained image bytes.
  const run=key=>new Script(plan.generatedPrograms[key].replaceAll(/\bimport\(/g,'fakeImport(')).runInNewContext({...sandbox},{timeout:2000});
  await run('bootstrapRecipe');assert.equal(proc.exitCode,undefined);assert.equal(calls.length,1);assert.equal(calls[0].stage,'recipe');assert.equal(mem.writes.length,5);assert.deepEqual(mem.files.get(plan.externalDirectory+'/control.json'),control);
  mem.setStdin(Buffer.from('UNREAD_PRIVATE_SYNTHETIC_INPUT'));await run('bootstrapPre');assert.equal(calls.length,2);assert.equal(calls[1].stage,'pre');assert.deepEqual(calls[1].control,calls[0].control);assert.equal(mem.writes.length,5);
  await run('bootstrapRecipe');assert.equal(proc.exitCode,1);assert.equal(calls.length,2);assert.equal(mem.writes.length,5);
  proc.exitCode=undefined;mem.files.set(plan.externalDirectory+'/control.json',Buffer.from(JSON.stringify({planSha256:plan.planSha256,deadlineNs:'9999999999999'})));await run('bootstrapPre');assert.equal(proc.exitCode,1);assert.equal(calls.length,2);assert.equal(mem.fds.size,0);assert.equal(logs.some(s=>s.includes('UNREAD_PRIVATE')),false);
 });
 test(name+': actual Bash cleanup control-flow consumes recipe only after all modeled inspect/guard/removal ACKs',()=>{
  const {plan}=planFor(module),line=decodedShell(plan.operation).split('\n').find(s=>s.startsWith('cleanup_native_validation(){'));assert.ok(line);assert.equal(line.split('>native-fresh-final-proof/cleanup-inspect.json').length,2);
  // Only inspection output is redirected to the null device. Timeout/Docker/
  // Node are explicit Bash-function stubs; actual generated Node ownership
  // guards have independent in-memory positive/negative tests above. This is
  // cleanup shell control-flow proof, NOT Docker removal or cgroup proof.
  const functionSource=line.replace('>native-fresh-final-proof/cleanup-inspect.json','>/dev/null'),id='a'.repeat(64);
  for(const [failure,expected]of [['',0],['read',70],['inspect',70],['guard',70],['remove',70]]){
   const script=`native_final_cleanup_done=' '\nmodel_failure='${failure}'\ntimeout(){ if [ "$2" = node ]; then if [ -n "\${VAETTIR_FINAL_CLEANUP_IDS-}" ]; then test "$model_failure" != guard; else test "$model_failure" != read || return 1; printf '%s' '${id}'; fi; elif [ "$2" = docker ]; then if [ "$3" = inspect ]; then test "$model_failure" != inspect; elif [ "$3" = rm ]; then test "$model_failure" != remove; else return 99; fi; else return 98; fi; }\n${functionSource}\ncleanup_native_validation\nrc=$?\nprintf '%s\\n%s' "$rc" "$native_final_cleanup_done"`;
   const observed=execFileSync(bashPath,['--noprofile','--norc','-c',script],{windowsHide:true,timeout:10000,encoding:'utf8',env:{SystemRoot:process.env.SystemRoot??'C:/Windows',PATH:process.platform==='win32'?'C:/Program Files/Git/bin':'/usr/bin:/bin',LC_ALL:'C'}}).split('\n');assert.equal(Number(observed[0]),expected);assert.equal(observed.slice(1).join('\n').includes(id),failure==='');
  }
 });
}
test('whole current v1/v2 source differs only exact three import specifiers and purpose',()=>{
 const v1=readFileSync(new URL('./native-builder-fresh-final-plan.mjs',import.meta.url),'utf8'),current=readFileSync(new URL('./native-packaging-v2-builder-fresh-final-plan.mjs',import.meta.url),'utf8');let expected=v1;
 for(const from of ['native-builder-fresh-core.mjs','native-builder-fresh-next-phase.mjs','native-builder-fresh-prepare.mjs']){const before='from "./'+from+'"',after='from "./native-packaging-v2-'+from.slice('native-'.length)+'"';assert.equal(expected.split(before).length,2);expected=expected.replace(before,after);}
 assert.equal(expected.split('purpose: "fresh-native-final-plan-not-runtime"').length,2);expected=expected.replace('purpose: "fresh-native-final-plan-not-runtime"','purpose: "native-packaging-v2-fresh-final-plan-not-runtime"');assert.equal(expected,current);
});
test('strict TEST isolation overlay rejects unknown, tampered, already-applied and caller replacements',()=>{
 const current=Buffer.from(readFileSync(new URL('./native-packaging-v2-builder-fresh-final-plan.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n'));
 assert.equal(sha(current),'50b83126cb75f29ae5269052e3719eb4ac3a2fef25e3304e3ea283e3acdd389f');
 const overlaySource=readFileSync(new URL('./native-final-recipe-isolation-test-overlay.mjs',import.meta.url),'utf8');const start=overlaySource.indexOf('const changes=['),end=overlaySource.indexOf('\nexport function reviewedRecipeIsolationTestOverlay',start);assert.ok(start>=0&&end>start);
 const changes=new Script(overlaySource.slice(start,end)+'\nchanges').runInNewContext({},{timeout:2000});let historical=current.toString();for(const[before,after]of [...changes].reverse()){assert.equal(historical.split(after).length,2);historical=historical.replace(after,before);}const originalBytes=Buffer.from(historical);assert.equal(sha(originalBytes),'3071479df0917cb68829480039e574a72c77bee82ccda2098dde390e1f9ca018');assert.deepEqual(reviewedRecipeIsolationTestOverlay(originalBytes),current);
 const tampered=Buffer.from(originalBytes);tampered[0]^=1;for(const b of [Buffer.from('unknown TEST source'),tampered,current])assert.throws(()=>reviewedRecipeIsolationTestOverlay(b));assert.throws(()=>reviewedRecipeIsolationTestOverlay(originalBytes,{replace:['guard','true']}));assert.throws(()=>reviewedRecipeIsolationTestOverlay(originalBytes,current));
});
