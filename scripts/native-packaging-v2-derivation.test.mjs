// Pure source/VM fixtures, NOT actual new Git archive/native/provider proof.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import vm from "node:vm";
import {deriveNativePackagingV2,LEGACY_SOURCE_PINS,V2_MODULE_NAMES} from "./native-packaging-v2-derivation.mjs";
import {historicalNativeV1RecipeFixture} from "./native-v1-recipe-test-fixture.mjs";
import {historicalNativeFinalPlanFixture,reviewedNativeFinalDiagnosticsTestOverlay} from "./native-final-plan-historical-test-fixture.mjs";
import {historicalNativeFinalAdapterFixture} from "./native-final-adapter-historical-test-fixture.mjs";
import {reviewedRecipeIsolationTestOverlay} from "./native-final-recipe-isolation-test-overlay.mjs";
const root=new URL("../",import.meta.url);
const sha=b=>createHash("sha256").update(b).digest("hex");
const fixtureName="native-final-runtime-recipe-fixture.mjs";
// Exact reviewed post-patch LF source representation, not the old f3e6 pin.
const fixturePin="d21a00d62295a71566e96963d36f0659bc0e1c9453c1236a99af5f0062659eac";
const historicalHelperName="native-v1-recipe-test-fixture.mjs";
const historicalHelperPin="7d3b68fc1c7ea944ce6548d48cb4ef7b103571ee80c1d96db33f74b059aee637";
// TEST ONLY: canonical Git LF and Windows CRLF reads map to one explicitly
// reviewed source representation. Compiler original pins remain strict.
function fixtureLf(raw){
  assert.ok(Buffer.isBuffer(raw));
  const text=new TextDecoder("utf-8",{fatal:true}).decode(raw);
  assert.ok(Buffer.from(text).equals(raw));
  return Buffer.from(text.replaceAll("\r\n","\n"));
}
// TEST ONLY fixed whole-hash-admitted memory diagnostics delta. The historical
// three overlays keep their exact original bytes and assertions. This fourth
// review permits only the public failure function and matching adapter pin.
function reviewedMemoryDiagnosticsOverlay(historicalDiagnostics){
  assert.ok(Buffer.isBuffer(historicalDiagnostics));
  assert.equal(sha(historicalDiagnostics),"939adbc2675d08eafca59b51b37d20dcc72246ee9a298244fc0032f7b475ed4f");
  const current=fixtureLf(readFileSync(new URL("scripts/native-packaging-v2-builder-fresh-final-plan.mjs",root)));
  const before=historicalDiagnostics.toString(),after=current.toString();
  const extract=text=>{
    const start=text.indexOf("export function nativeFinalPublicFailure(stage, error) {");
    const end=text.indexOf("\n\n// Serialized as trusted capsule source.",start);
    assert.ok(start>=0&&end>start);
    return text.slice(start,end);
  };
  const oldFunction=extract(before),newFunction=extract(after);
  assert.equal(before.split(oldFunction).length,2);assert.equal(after.split(newFunction).length,2);
  const oldPin="bbb313210d6826fc64fa57f1c85b5466c40075f05d88c46d6ed88a1316bae092",newPin="666a502ca862578bd6c9f49768f8df2107bd113db542637304c4a871a15426a5";
  assert.equal(before.split(oldPin).length,2);assert.equal(after.split(newPin).length,2);
  const memory=before.replace(oldFunction,newFunction).replace(oldPin,newPin);
  assert.equal(sha(memory),"3071479df0917cb68829480039e574a72c77bee82ccda2098dde390e1f9ca018");
  assert.equal(memory.replace(newFunction,oldFunction).replace(newPin,oldPin),before);
  return Buffer.from(memory);
}
function source(){
  const canonicalRecipe=readFileSync(new URL("scripts/build-llvm-runtime.sh",root));
  // Only strict whole-hash-admitted historical TEST evidence is reversed.
  // The production derivation API still admits exact-original buffers only.
  const historical=historicalNativeV1RecipeFixture(canonicalRecipe);
  return{recipe:historical.bytes,modules:Object.fromEntries(Object.keys(LEGACY_SOURCE_PINS).map(n=>[n,n==="native-builder-fresh-final-plan.mjs"?historicalNativeFinalPlanFixture():n==="native-builder-fresh-final-adapter.mjs"?historicalNativeFinalAdapterFixture():fixtureLf(readFileSync(new URL("scripts/"+n,root)))]))};
}
function sourcesForTest(input,v2){
  const derived=deriveNativePackagingV2(input);
  const publicBytes=Object.fromEntries(["build-llvm-runtime.sh","native-build-concurrency.mjs","native-llvm-checkpoint.mjs","fetch-runtime-vendor-sources.mjs","runtime-vendor-sources.json","check-llvm-package.mjs","check-llvm-jit.c","check-llvm-arm-defaults.cpp","reconcile-llvm-arm-unit-fixture.mjs","Dockerfile.api"].map(n=>[n,readFileSync(new URL(n==="Dockerfile.api"?n:"scripts/"+n,root))]));
  // Select the genuine reviewed v1 or v2 recipe BEFORE the synthetic ZIP is
  // constructed. Never replace entries after archival or claim a historical
  // fixture represents the actual current canonical source checkpoint.
  publicBytes["build-llvm-runtime.sh"]=v2?derived.correctedRecipe:input.recipe;
  publicBytes["native-builder-fresh-final-verifier.mjs"]=input.modules["native-builder-fresh-final-verifier.mjs"];
  publicBytes["native-builder-fresh-final-adapter.mjs"]=input.modules["native-builder-fresh-final-adapter.mjs"];
  const raw=fixtureLf(readFileSync(new URL("scripts/"+fixtureName,root)));assert.equal(sha(raw),fixturePin);
  const helper=fixtureLf(readFileSync(new URL("scripts/"+historicalHelperName,root)));assert.equal(sha(helper),historicalHelperPin);
  let fixture=raw.toString();
  if(v2){
    // Explicit V2 SYNTHETIC constructor only: preserve current corrected raw
    // recipe before ZIP creation, do not apply the historical-v1 test adapter.
    const historicalExpression="historicalNativeV1RecipeFixture(raw).bytes";
    assert.equal(fixture.split(historicalExpression).length,2);
    fixture=fixture.replace(historicalExpression,"raw");
  }
  for(const [a,b]of Object.entries(v2?V2_MODULE_NAMES:{}))fixture=fixture.replaceAll('from "./'+a+'"','from "./'+b+'"');
  // Test-only explicit synthetic public reader. Never import `.local` in
  // tracked production modules or hide a different real Git archive.
  for(const [a,b]of [["new URL(\"../\" + path, import.meta.url)","new URL(\"file:///synthetic-public/\" + path)"],["new URL(\"./\" + n, import.meta.url)","new URL(\"file:///synthetic-public/\" + n)"]]){assert.equal(fixture.split(a).length,2);fixture=fixture.replace(a,b);}
  return{derived,publicBytes,modules:{...(v2?derived.modules:input.modules),[fixtureName]:Buffer.from(fixture),[historicalHelperName]:helper}};
}
async function route(input,v2){
  const data=sourcesForTest(input,v2),context=vm.createContext({Buffer,TextDecoder,TextEncoder,URL,process:{env:{}}}),cache=new Map();
  // Fixture review contains JSON-only metadata. Keep its clone in the exact
  // VM realm of the validators, preserving strict prototypes rather than
  // relaxing genuine deep-equality assertions across artificial contexts.
  context.structuredClone=vm.runInContext("value=>JSON.parse(JSON.stringify(value))",context);
  const get=async name=>{
    if(cache.has(name))return cache.get(name);
    let m;
    if(name.startsWith("node:")){
      const ns=name==="node:fs"?{readFileSync:u=>{assert.ok(u instanceof URL);assert.equal(u.protocol,"file:");assert.equal(u.hostname,"");assert.ok(u.pathname.startsWith("/synthetic-public/"));const n=u.pathname.split("/").at(-1);assert.ok(n in data.publicBytes);return Buffer.from(data.publicBytes[n]);}}:await import(name);
      m=new vm.SyntheticModule(Object.keys(ns),function(){for(const [k,v]of Object.entries(ns))this.setExport(k,v);},{context,identifier:name});
    }else{
      assert.ok(name in data.modules,"Only exact trusted closure modules permitted");
      m=new vm.SourceTextModule(data.modules[name].toString(),{context,identifier:name});
    }
    cache.set(name,m);return m;
  };
  const fixture=await get(fixtureName);
  await fixture.link(name=>get(name.startsWith("./")?name.slice(2):name));
  await fixture.evaluate({timeout:10000});
  const loaded=name=>cache.get(v2?(V2_MODULE_NAMES[name]??name):name)?.namespace;
  return{data,fixture:fixture.namespace,loaded,async load(name){const m=await get(v2?(V2_MODULE_NAMES[name]??name):name);if(m.status==="unlinked")await m.link(spec=>get(spec.startsWith("./")?spec.slice(2):spec));if(m.status==="linked")await m.evaluate({timeout:10000});return m.namespace;}};
}
test("deterministic narrowly corrected recipe/derived import/pin/purpose bytes restore all originals",()=>{
  const s=source(),before=Object.fromEntries(Object.entries(s.modules).map(([n,b])=>[n,sha(b)])),r=deriveNativePackagingV2(s),again=deriveNativePackagingV2(s);
  assert.deepEqual(r,again);
  // Historical derivation remains exact. The CURRENT final planner has only
  // the explicit hash-admitted test diagnostics overlays; every other current
  // V2 producer still equals the original derivation byte-for-byte.
  for(const name of [...Object.values(V2_MODULE_NAMES),"native-builder-fresh-final-adapter.mjs"]){
    const canonical=fixtureLf(readFileSync(new URL("scripts/"+name,root)));
    if(name==="native-packaging-v2-builder-fresh-final-plan.mjs"){
      assert.notDeepEqual(canonical,r.modules[name],"Current diagnostics are not historical final bytes");
      assert.deepEqual(canonical,reviewedRecipeIsolationTestOverlay(reviewedMemoryDiagnosticsOverlay(reviewedNativeFinalDiagnosticsTestOverlay(r.modules[name]))));
    }else if(name==="native-builder-fresh-final-adapter.mjs"){
      assert.equal(sha(r.modules[name]),LEGACY_SOURCE_PINS[name]);
      assert.notDeepEqual(canonical,r.modules[name],"Current cgroup reader is not historical adapter evidence");
      assert.equal(sha(canonical),"666a502ca862578bd6c9f49768f8df2107bd113db542637304c4a871a15426a5");
    }else assert.deepEqual(canonical,r.modules[name]);
  }
  assert.match(r.correctedRecipe.toString(),/-Tdebian\/libllvm19\.substvars -f\/build\/libllvm19\.files/);
  for(const line of s.recipe.toString().split("\n").filter(l=>!l.startsWith("dpkg-gencontrol ")))assert.ok(r.correctedRecipe.toString().split("\n").includes(line),line);
  assert.deepEqual(Object.fromEntries(Object.entries(s.modules).map(([n,b])=>[n,sha(b)])),before);
  assert.equal(r.policy.cacheImportSupported,false);
  assert.equal(r.policy.exclusionsChanged,false);
  assert.equal(r.policy.freshNullParentRequired,true);
  assert.ok(Object.values(r.acceptance).every(x=>x===false));
  for(const name of ["native-builder-recovery.mjs","native-builder-continuation.mjs","native-builder-fresh-final-adapter.mjs","native-builder-fresh-final-verifier.mjs"])assert.deepEqual(r.modules[name],s.modules[name]);
});
test("constructor diagnostics TEST overlay admits only complete immutable historical v2 bytes",()=>{
  const historical=deriveNativePackagingV2(source()).modules["native-packaging-v2-builder-fresh-final-plan.mjs"];
  const preserved=Buffer.from(historical),result=reviewedNativeFinalDiagnosticsTestOverlay(historical);
  assert.equal(sha(historical),"2bd9aec0a28942513e5186b419fc0bc00d576b696f3f8139741e21612e6aa889");
  assert.equal(sha(result),"939adbc2675d08eafca59b51b37d20dcc72246ee9a298244fc0032f7b475ed4f");
  assert.deepEqual(historical,preserved,"Overlay cannot mutate historical source authority");
  const changed=Buffer.from(historical);changed[0]^=1;
  for(const candidate of [changed,historical.subarray(0,-1),Buffer.concat([historical,Buffer.from("\n")]),result,Buffer.alloc(0),historical.toString(),[historical],null])
    assert.throws(()=>reviewedNativeFinalDiagnosticsTestOverlay(candidate));
  assert.throws(()=>reviewedNativeFinalDiagnosticsTestOverlay(historical,{replacement:result}));
  assert.throws(()=>reviewedNativeFinalDiagnosticsTestOverlay());
  result[0]^=1;
  assert.equal(sha(reviewedNativeFinalDiagnosticsTestOverlay(historical)),"939adbc2675d08eafca59b51b37d20dcc72246ee9a298244fc0032f7b475ed4f");
  assert.deepEqual(historical,preserved);
});
test("historical final planner TEST source stays exact and cannot accept caller replacements",()=>{
  const original=historicalNativeFinalPlanFixture();
  assert.equal(original.length,41490);
  assert.equal(sha(original),"aa57331900911078457f44716b86b121f44bb45360cb90d02ac9ecb96b8b843e");
  original[0]^=1;
  assert.equal(sha(historicalNativeFinalPlanFixture()),"aa57331900911078457f44716b86b121f44bb45360cb90d02ac9ecb96b8b843e");
  assert.throws(()=>historicalNativeFinalPlanFixture(Buffer.from("unreviewed")));
});
test("unknown/truncated/modified original source or already-corrected recipe never derives",()=>{
  for(const mutate of [s=>s.recipe[0]^=1,s=>s.recipe=deriveNativePackagingV2(s).correctedRecipe,s=>s.modules.extra=Buffer.from("public but unreviewed"),s=>s.modules["native-builder-fresh-core.mjs"][0]^=1,s=>delete s.modules["native-builder-fresh-prepare.mjs"]]){const s=source();mutate(s);assert.throws(()=>deriveNativePackagingV2(s));}
});
test("frozen historical source-only v2 derivation plans coherent null-parent corrected lineage and dual-suite final",async()=>{
  const s=source(),v2=await route(s,true),f=v2.fixture.finalFixture(),plan=v2.loaded("native-builder-fresh-final-plan.mjs").planNativeFreshFinal(f);
  assert.equal(f.core.planningInput.preparePlan.identity.purpose,"native-packaging-v2-fresh-prepare-not-runtime");
  assert.equal(f.core.planningInput.preparePlan.identity.predecessorSha256,null);
  assert.equal(plan.identity.purpose,"native-packaging-v2-fresh-final-plan-not-runtime");
  assert.equal(plan.identity.scriptPins["build-llvm-runtime.sh"],v2.data.derived.policy.correctedRecipeLFHash);
  assert.equal(plan.identity.receipts.length,6);
  assert.equal(plan.request.autoRetryLimitOverride,0);
  const final=v2.fixture.runtimeCompletedFixture();
  const validator=await v2.load("native-final-runtime-recipe-validation.mjs");
  assert.equal(validator.validateFreshNativeFinalCompleted(final.completed,final.expected,final.plan,final.input,final.transport).phase,"final");
});
test("v1 historical source/receipts remain valid onlyv1; corrected v2 refuses every v1 ancestry",async()=>{
  const s=source(),v1=await route(s,false),v2=await route(s,true),old=v1.fixture.finalFixture(),fresh=v2.fixture.finalFixture();
  const oldPlan=v1.loaded("native-builder-fresh-final-plan.mjs").planNativeFreshFinal(old);
  assert.equal(oldPlan.identity.purpose,"fresh-native-final-plan-not-runtime");
  assert.equal(oldPlan.identity.scriptPins["build-llvm-runtime.sh"],sha(s.recipe));
  assert.throws(()=>v2.loaded("native-builder-fresh-final-plan.mjs").planNativeFreshFinal(old));
  assert.throws(()=>v1.loaded("native-builder-fresh-final-plan.mjs").planNativeFreshFinal(fresh));
  // Every legacy prepare/core/next completion is checked through its genuine
  // recursive original-input rederivation, not relabeled or rebuilt from claims.
  const p=old.core.planningInput;
  assert.doesNotThrow(()=>v1.loaded("native-builder-fresh-prepare.mjs").validateNativeFreshPrepareCompleted(p.completedPrepare,p.expectedPrepare,p.preparePlan));
  assert.throws(()=>v2.loaded("native-builder-fresh-prepare.mjs").validateNativeFreshPrepareCompleted(p.completedPrepare,p.expectedPrepare,p.preparePlan));
  assert.doesNotThrow(()=>v1.loaded("native-builder-fresh-core.mjs").validateNativeFreshCoreCompleted(old.core.completed,old.core.expected,old.core.plan,old.core.planningInput));
  assert.throws(()=>v2.loaded("native-builder-fresh-core.mjs").validateNativeFreshCoreCompleted(old.core.completed,old.core.expected,old.core.plan,old.core.planningInput));
  for(const entry of old.completedPhases){
    const through={core:old.core,phase:entry.plan.identity.phase,completedPhases:old.completedPhases.slice(0,old.completedPhases.indexOf(entry)),budget:{mode:"bounded-probe",compileSeconds:1980,postCompileReserveSeconds:240,totalSeconds:2520}};
    assert.doesNotThrow(()=>v1.loaded("native-builder-fresh-next-phase.mjs").validateNativeFreshNextPhaseCompleted(entry.completed,entry.expected,entry.plan,through));
    assert.throws(()=>v2.loaded("native-builder-fresh-next-phase.mjs").validateNativeFreshNextPhaseCompleted(entry.completed,entry.expected,entry.plan,through));
  }
  assert.deepEqual(Object.fromEntries(Object.entries(s.modules).map(([n,b])=>[n,sha(b)])),LEGACY_SOURCE_PINS);
});
test("old canonical source origin and recipe ZIP refuse before any v2 lineage can start",async()=>{
  const s=source(),v1=await route(s,false),v2=await route(s,true);
  const old=v1.fixture.runtimeApplicationFixture();
  const corrected=v2.fixture.runtimeApplicationFixture();
  assert.throws(()=>v2.loaded("native-builder-fresh-prepare.mjs").planNativeFreshPrepare(old));
  assert.throws(()=>v1.loaded("native-builder-fresh-prepare.mjs").planNativeFreshPrepare(corrected));
  const forbidden=v2.fixture.runtimeApplicationFixture("3ce9a23715386059765ed221351de1f3bd9aa3bb");
  assert.throws(()=>v2.loaded("native-builder-fresh-prepare.mjs").planNativeFreshPrepare(forbidden),/distinct canonical source commit/);
});
