import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { hash, begin } from "./core.mjs";
import { planFor, propose, checked } from "./produce.mjs";
import { derive } from "./derive.mjs";
import { webApplicability, apiRuntimeEvidence, companionRuntime } from "./applicability.mjs";
import { admitFixtureSource } from "./source-admission.mjs";
const here=fileURLToPath(new URL('.',import.meta.url)),root=resolve(here,'../..');
const policy=JSON.parse(readFileSync(resolve(here,'policy.json'))),source=policy.source;
const read=p=>readFileSync(resolve(root,p));
function evidence(){const files=new Map();return {files,read:p=>files.get(p),put:(path,value)=>{const b=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));files.set(path,b);return {path,bytes:b.length,sha256:hash(b)};}};}
function webCase(){
  const e=evidence(),digest="sha256:"+"d".repeat(64),after=Array.from({length:642},(_,i)=>({path:"usr/lib/native"+i,sha256:"a".repeat(64),bytes:1,mode:0o755,uid:0,gid:0,nativeKind:"ELF"}));
  const refs={nativeAfter:e.put('after.json',after)};
  const obs={source,role:"web",image:`051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-web@${digest}`,actual:false,applicable:false,browserApplicable:false,absenceObserved:true,fullNativeInventorySha256:refs.nativeAfter.sha256,reason:"NO_PRISMA_ENGINE_IN_COMPLETE_REVIEWED_NATIVE_INVENTORY",scanned:after};
  refs.applicabilityObservation=e.put('obs.json',obs);
  const proof=e.put('proof.txt',Buffer.from('synthetic'));
  const review={scope:"WEB_NATIVE_APPLICABILITY",accepted:true,independentReview:true,source,imageDigest:digest,inventorySha256:refs.nativeAfter.sha256,observationSha256:refs.applicabilityObservation.sha256,completeFilesystem:true,nativeEqualityUnchanged:true,proofTree:e.put('tree.json',{files:[proof]})};
  refs.applicabilityReview=e.put('review.json',review);
  const absence={actual:false,applicable:false,absenceObserved:true,reason:"ABSENT_FROM_COMPLETE_FINAL_NATIVE_INVENTORY",observationSha256:refs.applicabilityObservation.sha256};
  const audit={role:"web",imageDigest:digest,applicability:{schema:"web-native-applicability/v1",source,role:"web",imageDigest:digest,inventorySha256:refs.nativeAfter.sha256,apiBrowserCompanionRequired:true,actualWeb23Required:true},browser:{...absence},prisma:{...absence}};
  return {...e,refs,after,obs,review,audit};
}
test("Web applicability requires scoped absence instead of load success",()=>{const c=webCase();assert.equal(webApplicability(c.audit,c.refs,c.read,c.after),undefined);assert.equal(c.audit.prisma.actual,false);});
for(const key of ['schema','source','role','imageDigest','inventorySha256','apiBrowserCompanionRequired','actualWeb23Required'])test('Web refuses absent identity '+key,()=>{const c=webCase();delete c.audit.applicability[key];assert.throws(()=>webApplicability(c.audit,c.refs,c.read,c.after));});
test("Web refuses missing, boolean-success and mismatched observations",()=>{
  for(const change of [{actual:true},{applicable:true},{absenceObserved:false},{observationSha256:"0".repeat(64)}]){const c=webCase();Object.assign(c.audit.prisma,change);assert.throws(()=>webApplicability(c.audit,c.refs,c.read,c.after),/typed/);}
  const c=webCase();delete c.refs.applicabilityObservation;assert.throws(()=>webApplicability(c.audit,c.refs,c.read,c.after));
});
test("Web independent review and its full evidence tree cannot be waived",()=>{
  for(const key of ['accepted','independentReview','completeFilesystem','nativeEqualityUnchanged']){const c=webCase();c.review[key]=false;c.refs.applicabilityReview=c.put('review.json',c.review);assert.throws(()=>webApplicability(c.audit,c.refs,c.read,c.after),/Independent/);}
  const c=webCase();c.files.set('proof.txt',Buffer.from('changed'));assert.throws(()=>webApplicability(c.audit,c.refs,c.read,c.after),/Artifact mismatch/);
});
test("Web absence covers every unique final native path and metadata tuple",()=>{
  for(const change of [rows=>rows.pop(),rows=>{rows[0]={...rows[0],uid:7};},rows=>{rows[0]=rows[1];}]){const c=webCase();const after=structuredClone(c.after);change(after);assert.throws(()=>webApplicability(c.audit,c.refs,c.read,after),/every final/);}
  const c=webCase();const after=structuredClone(c.after);after[0].path='usr/lib/query-engine.so';c.obs.scanned=after;c.refs.applicabilityObservation=c.put('obs.json',c.obs);c.audit.prisma.observationSha256=c.refs.applicabilityObservation.sha256;c.audit.browser.observationSha256=c.refs.applicabilityObservation.sha256;c.review.observationSha256=c.refs.applicabilityObservation.sha256;c.refs.applicabilityReview=c.put('review.json',c.review);assert.throws(()=>webApplicability(c.audit,c.refs,c.read,after),/engine path/);
});
function apiCase(){const e=evidence(),digest='sha256:'+"b".repeat(64),common={actual:true,role:'api',source,image:`051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api@${digest}`};const browser={...common,domInteraction:true,rasterSha256:'e'.repeat(64),customerPage:false,browserSha256:'4fa61f0ba0b4f89b7bec242c32ca16d3bccf69dbfef0651924a9ba8fede5f9d6'},prisma={...common,applicable:true,actualCreateAndRead:true,syntheticDatabase:true,schemaSteps:1,queryEngineSha256:'35860a5c0fb2f79e7b38c40747c4d212318d97e1910ca528b133c802716de0b8',schemaEngineSha256:'cedeae04739cfa085493da2bafb5d1e4da0247fc74f2995a51ee24f20c9890be'};return {...e,digest,browser,prisma,refs:{browserObservation:e.put('browser.json',browser),prismaObservation:e.put('prisma.json',prisma)}};}
test("API requires actual render and both schema/query engines",()=>{const c=apiCase();apiRuntimeEvidence({imageDigest:c.digest},c.refs,c.read);for(const change of [{schemaSteps:0},{actualCreateAndRead:false},{actual:false},{schemaEngineSha256:'0'.repeat(64)},{image:'other'}]){const c=apiCase();c.refs.prismaObservation=c.put('prisma.json',{...c.prisma,...change});assert.throws(()=>apiRuntimeEvidence({imageDigest:c.digest},c.refs,c.read));}});
test("Companion seal needs both actual API browser and same-source Web23",()=>{
  const e=evidence(),a='sha256:'+'a'.repeat(64),w='sha256:'+'b'.repeat(64),audit={role:'api',imageDigest:a,browser:{actual:true,exitCode:0},prisma:{actual:true,exitCode:0}};
  const ar=e.put('api.json',audit),review=e.put('accept.json',{accepted:true,independentReview:true,auditSha256:ar.sha256}),web={sourceCommit:source,imageDigest:w,checks:23,passed:true,productionCredentialsUsed:false,customerWrites:false};
  const b={final:{api:{nativeRuntime:{audit:ar,acceptance:review}}},runtime:{results:{web:e.put('web.json',web)}}};companionRuntime(b,source,a,w,e.read);
  b.runtime.results.web=e.put('web.json',{...web,checks:22});assert.throws(()=>companionRuntime(b,source,a,w,e.read),/Web23/);
});
test("Actual retained evidence generates seven source scripts with null final image",()=>{
  for(const role of ['api','web']){const r=propose(role,policy,{final:null},read,n=>readFileSync(resolve(here,n)));assert.equal(r.proposal.accepted,false);assert.equal(r.proposal.nativeAccepted,false);assert.equal(r.proposal.actualFinalImageRequired,true);assert.equal(r.proposal.fixtures.length,role==='api'?4:3);for(const f of r.proposal.fixtures){assert.equal(f.reviewProposal.accepted,false);assert.equal(f.script.sha256,hash(r.files[f.script.path]));assert.deepEqual(f.argv,['/usr/local/bin/node',`/run/vaettir-native/${f.name}.mjs`]);}}
});
test("Generation refuses altered retained proof and ambiguous final input",()=>{
  assert.throws(()=>planFor('api',policy,{final:undefined},read),/Final image/);
  assert.throws(()=>planFor('api',policy,{final:null},p=>p===policy.sqlite.probe.path?Buffer.alloc(policy.sqlite.probe.bytes):read(p)),/Evidence bytes/);
  assert.throws(()=>checked({path:'x',sha256:'a'.repeat(64),bytes:17*1024**2},()=>Buffer.alloc(0)),/Bounded/);
});
test("Actual final inventory requires independently accepted exact stage-minus-tool equality",()=>{
  const role='web',rows=JSON.parse(read(policy.roles.web.inventory.path)).filter(x=>x.path!=='tmp/vaettir-sqlite-overlay-v1/sqlite-runtime-regression'),e=evidence(),digest='sha256:'+'c'.repeat(64);
  const inventory=e.put('final.json',rows),review=e.put('final-review.json',{accepted:true,independentReview:true,inventorySha256:inventory.sha256,imageDigest:digest,source,completeFilesystem:true,stageInventorySha256:policy.roles.web.inventory.sha256}),inputs={final:{imageDigest:digest,inventory,review}},r=p=>e.files.has(p)?e.read(p):read(p);
  assert.equal(planFor(role,policy,inputs,r).image,`051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-web@${digest}`);
  rows[0].uid++;inputs.final.inventory=e.put('final.json',rows);assert.throws(()=>planFor(role,policy,inputs,r),/exact stage/);
});
test("Source admission refuses absent approval before any operation",()=>{assert.throws(()=>admitFixtureSource({},()=>Buffer.from('{}')));});
test("All seven derived source files equal exact frozen transformations",()=>{const d=derive(policy,read);assert.equal(Object.keys(d).length,7);for(const [n,b]of Object.entries(d))assert.deepEqual(b,readFileSync(resolve(here,n)),n);const x=structuredClone(policy);x.parents[0].sha256='0'.repeat(64);assert.throws(()=>derive(x,read),/parent/);});
test("Derived admission preserves API block, NSS and full inventories",()=>{
  const d=derive(policy,read),s=d['native-release-gates.derived.mjs'].toString(),old=read(policy.parents[0].path).toString();
  const start=old.indexOf('  if (policy.roles[role].nssVersion)'),end=old.indexOf('  requireThat(\n    audit.browser.actual');assert(s.includes(old.slice(start,end)));
  assert(s.includes('audit.browser.actual === true &&\n      audit.browser.exitCode === 0 &&\n      audit.prisma.actual === true &&\n      audit.prisma.exitCode === 0'));
  assert(s.includes('same(expected, after)'));assert(s.includes('audit.discovery.dynamicLookupsReviewed === true'));assert(s.includes('apiRuntimeEvidence(audit, refs, read)'));
  assert(d['operator-contracts.derived.py'].toString().includes("'posixInventory','nativeFixtureSource')"));
  assert(d['operator-contracts.derived.py'].toString().includes("str(FIXTURE_PACKAGE/'release-context.derived.mjs')"));
  assert(d['seal-runtime.derived.mjs'].toString().includes('companionRuntime(b, source, api.component.imageDigest, web.component.imageDigest, io.read)'));
});
test("Derived MJS transitive module graph imports inertly",async()=>{for(const n of ['native-release-gates.derived.mjs','release-admission.derived.mjs','release-context.derived.mjs','native-probe-context.derived.mjs','seal-runtime.derived.mjs','generate.mjs'])await import(new URL(n,import.meta.url));});
test("No generated image-null source is executable as an accepted fixture",()=>{
  const p=planFor('web',policy,{final:null},read);assert.throws(()=>begin({...p,kind:'prisma'},{platform:'linux',read:()=>Buffer.from('{}')}),/final image/);
});
