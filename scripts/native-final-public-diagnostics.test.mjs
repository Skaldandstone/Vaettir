// Synthetic public diagnostics/actual generated runner logic ONLY.
// No native filesystem, commands, LLVM, cloud or release acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {Script} from "node:vm";
import * as original from "./native-builder-fresh-final-plan.mjs";
import * as v2 from "./native-packaging-v2-builder-fresh-final-plan.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
const plan="a".repeat(64);
const dir="/tmp/vaettir-fresh-final-capsule-"+plan;
const sensitive="PRIVATE_MESSAGE_TOKEN_do_not_publish";
function error(code="ERR_ASSERTION",script="native-builder-fresh-final-verifier.mjs") {
  const e=new Error(sensitive);
  e.code=code;
  Object.defineProperty(e,"stack",{value:"Error: "+sensitive+"\n    at exact ("+dir+"/"+script+":123:45)\n    at private (/private/"+sensitive+"/secret.mjs:9:2)",writable:true,configurable:true});
  return e;
}
for(const[name,module]of [["original",original],["packaging-v2",v2]]) {
 test(name+": constructor check labels are own-data, stage-scoped and bounded",()=>{
  for(const check of ["options","platform-identity","deadline","memory-read","memory-admission","final-log-hash","filesystem-capability","checkpoint-read","checkpoint-hash","checkpoint-import-scope","checkpoint-import","checkpoint-rehash","checkpoint-exports","abi-read","abi-hash","abi-import-scope","abi-import","abi-rehash","abi-exports"]) {
   const e=new Error(sensitive);e.code="ERR_ASSERTION";
   Object.defineProperty(e,"nativeFinalAdapterCheck",{value:check});
   for(const stage of ["runtime-adapter","bootstrap-runtime"]) {
    const value=module.nativeFinalPublicFailure(stage,e);
    assert.equal(value.adapterCheck,check);assert.equal(value.errorCode,"ERR_ASSERTION");
    assert.doesNotMatch(JSON.stringify(value),/PRIVATE_MESSAGE/);
   }
   assert.equal(Object.hasOwn(module.nativeFinalPublicFailure("runtime-verifier",e),"adapterCheck"),false);
  }
  let calls=0;const accessor={};
  Object.defineProperty(accessor,"nativeFinalAdapterCheck",{get(){calls++;return "memory-read";}});
  assert.equal(Object.hasOwn(module.nativeFinalPublicFailure("runtime-adapter",accessor),"adapterCheck"),false);
  assert.equal(calls,0);
  for(const e of [{nativeFinalAdapterCheck:sensitive},Object.create({nativeFinalAdapterCheck:"memory-read"})])
   assert.equal(Object.hasOwn(module.nativeFinalPublicFailure("runtime-adapter",e),"adapterCheck"),false);
 });
 test(name+": only approved stage/code/script numeric frames are public",()=>{
  const value=module.nativeFinalPublicFailure("runtime-verifier",error());
  assert.deepEqual(value,{schemaVersion:1,purpose:"bounded-public-native-final-failure-not-acceptance",stage:"runtime-verifier",errorCode:"ERR_ASSERTION",frames:[{script:"native-builder-fresh-final-verifier.mjs",line:123,column:45}]});
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE_MESSAGE|\/tmp\/|\/private\/|secret/);
  const unknown=module.nativeFinalPublicFailure(sensitive,error(sensitive));
  assert.equal(unknown.stage,"UNCLASSIFIED");assert.equal(unknown.errorCode,"UNCLASSIFIED");
  assert.doesNotMatch(JSON.stringify(unknown),/PRIVATE_MESSAGE/);
 });
 test(name+": bounded frame tail rejects foreign paths, zero/oversized positions and arbitrary names",()=>{
  const e=error();e.stack=sensitive.repeat(10000)+"\n"+[
   "    at fn ("+dir+"/unknown.mjs:10:2)",
   "    at fn (/private/native-builder-fresh-final-verifier.mjs:10:2)",
   "    at fn ("+dir+"/native-builder-fresh-final-verifier.mjs:0:2)",
   "    at fn ("+dir+"/native-builder-fresh-final-verifier.mjs:99999999:2)",
   ...Array.from({length:8},()=> "    at fn (file://"+dir+"/native-builder-fresh-final-adapter.mjs:12:3)"),
  ].join("\n");
  const value=module.nativeFinalPublicFailure("runtime-adapter",e);
  assert.equal(value.frames.length,4);assert.ok(value.frames.every(x=>x.script==="native-builder-fresh-final-adapter.mjs"&&x.line===12&&x.column===3));
  assert.ok(Buffer.byteLength(JSON.stringify(value))<1024);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE_MESSAGE|unknown|\/private|file:/);
 });
 test(name+": accessor/hostile error metadata cannot leak or turn refusal into acceptance",()=>{
  let getterCalls=0;const e={};
  Object.defineProperty(e,"code",{get(){getterCalls++;throw new Error(sensitive);}});
  Object.defineProperty(e,"stack",{get(){getterCalls++;return sensitive;}});
  assert.deepEqual(module.nativeFinalPublicFailure("runtime-cleanup",e).frames,[]);
  assert.equal(getterCalls,0);
  const hostile=new Proxy({},{getOwnPropertyDescriptor(){throw new Error(sensitive);}});
  assert.equal(module.nativeFinalPublicFailure("runtime-cleanup",hostile).errorCode,"UNCLASSIFIED");
  assert.doesNotMatch(JSON.stringify(module.nativeFinalPublicFailure("runtime-cleanup",hostile)),/PRIVATE_MESSAGE/);
 });
 test(name+": native Error stack accessor is not invoked and stage/code stay available",()=>{
  const e=new Error(sensitive);e.code="ERR_ASSERTION";
  const own=Object.getOwnPropertyDescriptor(e,"stack");
  const value=module.nativeFinalPublicFailure("runtime-verifier",e);
  assert.equal(value.stage,"runtime-verifier");assert.equal(value.errorCode,"ERR_ASSERTION");
  if(!own||!Object.hasOwn(own,"value"))assert.deepEqual(value.frames,[]);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE_MESSAGE/);
 });
}
function runner(module) {
 const mods=Object.fromEntries(Object.entries(module.FINAL_CAPSULE_PINS).map(([name,pin])=>{
  const b=readFileSync(new URL(name,import.meta.url));assert.equal(sha(b),pin);return[name,{base64:b.toString("base64"),sha256:pin}];
 }));
 const c=JSON.parse(module.createNativeFreshFinalCapsule(mods).bytes);
 return Buffer.from(c.members["native-fresh-final-runner.mjs"].base64,"base64").toString();
}
async function runSynthetic(module,failure) {
 const injected=error(),logs=[],writes=[],calls=[];
 const final={phase:"final",predecessorSha256:"p",inputsSha256:"i",proof:{"llvm-arm-policy":"r","llvm-cpu-jit":"j"}};
 const files=new Map([[dir+"/final.log",Buffer.from("synthetic compiler log")],["/build/llvm-phase-receipts/final.json",Buffer.from(JSON.stringify(final))]]);
 const fds=new Map();let next=1;
 const fs={constants:{O_RDONLY:0,O_NOFOLLOW:0},existsSync:()=>false,lstatSync(path){const bytes=files.get(path);assert.ok(bytes);return{isFile:()=>true,isSymbolicLink:()=>false,size:bytes.length,ino:1};},openSync(path){const fd=next++;fds.set(fd,path);return fd;},fstatSync:()=>({ino:1}),readFileSync:fd=>files.get(fds.get(fd)),closeSync:fd=>fds.delete(fd),writeFileSync(path){writes.push(path);}};
 const adapter={ops:{},provenance:{},cleanupOwnedExtraction(){calls.push("cleanup");if(failure==="runtime-cleanup")throw injected;}};
 const fakeImport=async name=>{
  if(name==="node:fs")return fs;
  if(name==="node:perf_hooks")return{performance:{now:()=>0}};
  if(name==="node:assert/strict")return{default:assert};
  if(name==="node:crypto")return{createHash};
  if(name==="node:child_process")return{spawnSync(){calls.push("recipe");return{error:undefined,signal:null,status:failure==="runtime-recipe"?1:0};}};
  if(name.endsWith("/native-builder-fresh-final-adapter.mjs"))return{async createNativeFreshFinalAdapter(){calls.push("adapter");if(failure==="runtime-adapter")throw injected;return adapter;}};
  if(name.endsWith("/native-builder-fresh-final-verifier.mjs"))return{verifyNativeFreshFinalState(){calls.push("verifier");if(failure==="runtime-verifier")throw injected;return{};}};
  if(name.endsWith("/native-fresh-final-transport.mjs"))return{encodeNativeFreshFinalLog:()=>[]};
  throw new Error("Unexpected synthetic import");
 };
 const source=runner(module).replace("export async function runtime","async function runtime").replaceAll(/\bimport\(/g,"fakeImport(");
 const sandbox={fakeImport,Buffer,process:{env:{PYTHONDONTWRITEBYTECODE:"1"},hrtime:{bigint:()=>0n}},console:{error:x=>logs.push(x),log:x=>logs.push(x)},control:{planSha256:plan,externalDirectory:dir,deadlineNs:"2400000000000",recipeSeconds:60,verificationReserveSeconds:600,parentReceiptSha256:"p",inputsSha256:"i",scriptPins:{},capsuleMembers:{},receipts:[]}};
 // Import interception is fixture-only; all generated stage/try/finally/catch
 // logic executes verbatim, no native calls or trusted proof substituted.
 await assert.rejects(new Script(source+"\nruntime('pre',control)").runInNewContext(sandbox,{timeout:2000}));
 const diagnostic=logs.filter(x=>x.startsWith("NATIVE_FRESH_FINAL_FAILURE="));assert.equal(diagnostic.length,1);
 const value=JSON.parse(diagnostic[0].slice("NATIVE_FRESH_FINAL_FAILURE=".length));
 assert.equal(value.stage,failure);assert.equal(value.errorCode,"ERR_ASSERTION");
 assert.equal(writes.length,0);assert.ok(!logs.some(x=>x.startsWith("NATIVE_FRESH_FINAL_REVIEW=")));
 assert.doesNotMatch(logs.join("\n"),/PRIVATE_MESSAGE|\/private\/|\/tmp\//);
 return calls;
}
for(const[name,module]of [["original",original],["packaging-v2",v2]]) {
 for(const failure of ["runtime-recipe","runtime-adapter","runtime-verifier","runtime-cleanup"])test(name+": actual generated runner "+failure+" still rejects with bounded diagnostics",async()=>{
  const calls=await runSynthetic(module,failure);
  if(failure==="runtime-recipe")assert.deepEqual(calls,["recipe"]);
  if(failure==="runtime-adapter")assert.deepEqual(calls,["recipe","adapter"]);
  if(failure==="runtime-verifier"||failure==="runtime-cleanup")assert.deepEqual(calls,["recipe","adapter","verifier","cleanup"]);
 });
}

for(const[name,module,file]of [["original",original,"native-builder-fresh-final-plan.mjs"],["packaging-v2",v2,"native-packaging-v2-builder-fresh-final-plan.mjs"]]) {
 test(name+": actual bootstrap failure catch publishes only bounded metadata and retains exit1",async()=>{
  const text=readFileSync(new URL(file,import.meta.url),"utf8");
  const match=/  const bootstrap = \(stage\) =>\n\s+(\x60[\s\S]*?\x60);\n  const containerGuard/.exec(text.replaceAll("\r\n","\n"));
  assert.ok(match,"Actual generated bootstrap template required");
  const logs=[],proc={env:{},exitCode:undefined};
  const scope={common:"const fs=mockFs,assert=mockAssert;",nativeFinalPublicFailure:module.nativeFinalPublicFailure,dir,identity:{capsule:{members:{},bytes:1,sha256:"b".repeat(64)}},planSha256:plan,console:{error:x=>logs.push(x)},process:proc,mockFs:{},mockAssert:assert};
  const source=new Script("const bootstrap=stage=>"+match[1]+";bootstrap('pre')").runInNewContext(scope,{timeout:2000});
  await new Script(source).runInNewContext(scope,{timeout:2000});
  assert.equal(proc.exitCode,1);
  assert.equal(logs.at(-1),"Pinned final verification refused");
  const value=JSON.parse(logs[0].slice("NATIVE_FRESH_FINAL_FAILURE=".length));
  assert.equal(value.stage,"bootstrap-materialize");assert.equal(value.errorCode,"ERR_ASSERTION");
  assert.ok(Buffer.byteLength(logs[0])<1024);assert.doesNotMatch(logs.join("\n"),/PRIVATE_MESSAGE|\/tmp\/|process\.env/);
 });
}
