import assert from "node:assert/strict";
import test from "node:test";
import { legacyPlanMetadataPatch, planMetadataChanges, planMetadataRecord } from "./plan-root-metadata.ts";
test("native NULL/arrays/scalars are retained nonobjects, never empty replacement records",()=>{
  for(const value of [null,undefined,[],[null,0,false],false,0,""," exact prose "]){
    assert.equal(planMetadataRecord(value),null);assert.deepEqual(legacyPlanMetadataPatch(value,undefined),{});
    assert.throws(()=>legacyPlanMetadataPatch(value,{}),/read-only/);
  }
});
test("record patch requires explicit edit and preserves exact raw reserved/unknown metadata",()=>{
  const raw=JSON.parse('{"__proto__":{"retained":true},"constructor":null,"future":["",false,0]}');
  assert.equal(planMetadataRecord(raw),raw);assert.deepEqual(legacyPlanMetadataPatch(raw,undefined),{});
  assert.equal(legacyPlanMetadataPatch(raw,raw).customFields,raw);
  assert.equal(Object.getPrototypeOf(raw),Object.prototype);assert.equal(Object.hasOwn(raw,"__proto__"),true);
  const nullPrototype=Object.assign(Object.create(null),{field:false});assert.equal(planMetadataRecord(nullPrototype),nullPrototype);
});
test("history compares whole retained roots without Object.keys(null), preserving empty/NULL/order distinctions",()=>{
  assert.deepEqual(planMetadataChanges(null,null),[]);
  for(const [current,prior] of [[null,{}],["",null],[[1,2],[2,1]],[false,0],[[],{}]])assert.deepEqual(planMetadataChanges(current,prior),["Retained root metadata changed"]);
  assert.deepEqual(planMetadataChanges({keep:" exact ",added:null},{keep:"exact",removed:0}),["keep changed","added added","removed removed"]);
});
