import assert from "node:assert/strict";
import { test } from "vitest";
import { fieldStylesForSnapshot } from "./case-field-style-snapshot";
const origin = {projectId:"project",organizationId:"org",clerkActorId:"actor",caseId:"case"};
const configuration = Object.freeze({version:1,fields:Object.freeze({notes:Object.freeze({widget:"PARAGRAPH"})})});
const read = {projectId:"project",organizationId:"org",caseId:null,readScope:{projectId:"project",organizationId:"org",actorId:"native",actorClerkUserId:"actor"},definitionSupported:true,fieldAuthoringSchemaHash:"hash",configurationSupported:true,configuration,warnings:[]};
test("presentation admission keeps exact snapshot identity and does not treat project permission as case write authorization",()=>{
  assert.equal(fieldStylesForSnapshot(read,origin,"hash").configuration,configuration);
  assert.equal(fieldStylesForSnapshot(read,origin,"hash").warning,null);
  assert.deepEqual(Object.keys(configuration.fields.notes),["widget"]);
});
test("different project/org/native read actor, malformed scope and native schema cannot transfer styles",()=>{
  for(const patch of [{projectId:"other"},{organizationId:"other"},{caseId:"case"},{readScope:{...read.readScope,projectId:"other"}},{readScope:{...read.readScope,organizationId:"other"}},{readScope:{...read.readScope,actorId:""}},{readScope:{...read.readScope,actorClerkUserId:"other"}},{definitionSupported:false},{fieldAuthoringSchemaHash:"changed"},{configurationSupported:false}]) {
    const refused=fieldStylesForSnapshot({...read,...patch} as unknown as Parameters<typeof fieldStylesForSnapshot>[0],origin,"hash");
    assert.equal(refused.configuration,undefined);assert.ok(refused.warning);
  }
  assert.equal(fieldStylesForSnapshot(read,null,"hash").configuration,undefined);
});
test("absent settings remain absent; unsupported saved config never becomes fabricated empty settings",()=>{
  const {configuration:_,...missing}=read;
  assert.deepEqual(fieldStylesForSnapshot(missing,origin,"hash"),{configuration:undefined,warning:null});
  for(const configuration of [null,undefined,{version:99,fields:{}},{version:1,fields:{notes:{widget:"URL"}}}]) {
    const fallback=fieldStylesForSnapshot({...read,configuration},origin,"hash");assert.equal(fallback.configuration,undefined);assert.ok(fallback.warning);
  }
});
