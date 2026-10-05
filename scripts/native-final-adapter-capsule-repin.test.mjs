// Actual current public capsule byte contracts only; no native/build acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import * as original from "./native-builder-fresh-final-plan.mjs";
import * as v2 from "./native-packaging-v2-builder-fresh-final-plan.mjs";
import {historicalNativeFinalAdapterFixture,HISTORICAL_FINAL_ADAPTER_SHA256} from "./native-final-adapter-historical-test-fixture.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
const adapterName="native-builder-fresh-final-adapter.mjs";
const currentAdapterSha="e668eee94bc13f87affcdf6565a9853f867724772a55bc80e5b9b29cc6476a25";
test("exact historical adapter remains available only as strict TEST source evidence",()=>{
 const b=historicalNativeFinalAdapterFixture();assert.equal(b.length,35685);assert.equal(sha(b),HISTORICAL_FINAL_ADAPTER_SHA256);
 assert.equal(HISTORICAL_FINAL_ADAPTER_SHA256,"5b0e360140ac894f81d62ce4aaf552fd58e85df4b880d13e16c4de3a3050d21b");
 b[0]^=1;assert.equal(sha(historicalNativeFinalAdapterFixture()),HISTORICAL_FINAL_ADAPTER_SHA256);
 assert.throws(()=>historicalNativeFinalAdapterFixture(Buffer.from("unreviewed")));
});
for(const[name,module]of [["original",original],["packaging-v2",v2]]){
 test(name+": current capsule pins the actual cgroup-compatible adapter and preserves verifier",()=>{
  assert.equal(module.FINAL_CAPSULE_PINS[adapterName],currentAdapterSha);
  assert.equal(module.FINAL_CAPSULE_PINS["native-builder-fresh-final-verifier.mjs"],"3485c951647c08da77994f73389ccc48654e6148dd539d49fca06269e607a2ff");
  const modules=Object.fromEntries(Object.entries(module.FINAL_CAPSULE_PINS).map(([n,h])=>{const b=readFileSync(new URL(n,import.meta.url));assert.equal(sha(b),h);return[n,{base64:b.toString("base64"),sha256:h}];}));
  const capsule=module.createNativeFreshFinalCapsule(modules),data=JSON.parse(capsule.bytes);
  assert.deepEqual(Object.keys(data.members).sort(),[adapterName,"native-builder-fresh-final-verifier.mjs","native-fresh-final-runner.mjs","native-fresh-final-transport.mjs"].sort());
  assert.equal(data.members[adapterName].bytes,37200);assert.equal(data.members[adapterName].sha256,currentAdapterSha);
  assert.match(Buffer.from(data.members[adapterName].base64,"base64").toString(),/export function readNativeFinalMemory\(io = fs\)/);
  assert.equal(capsule.s3Key,"native-helper-capsules/"+sha(capsule.bytes)+".json");
  // A genuinely old module cannot be relabeled current, either by old or forged pin.
  for(const pin of [HISTORICAL_FINAL_ADAPTER_SHA256,currentAdapterSha])assert.throws(()=>module.createNativeFreshFinalCapsule({...modules,[adapterName]:{base64:historicalNativeFinalAdapterFixture().toString("base64"),sha256:pin}}));
 });
}
