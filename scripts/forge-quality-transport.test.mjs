import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createQualityTransport} from '../integrations/atlassian/src/transport.ts';

for (const action of ['LIST','IDENTITY','CONNECT']) test(`${action}: old API gives actionable feedback without a POST`, async()=>{
  const calls=[];
  const remote=createQualityTransport(async request=>{calls.push(request);return {status:200,body:{status:'ok'}};});
  await assert.rejects(remote({action}),/waiting for the Vaettir API update/);
  assert.deepEqual(calls,[{path:'/api/health/detailed',method:'GET'}]);
});
test('ready API receives a JSON object without a duplicate bridge content-type',async()=>{
  const calls=[], evidence={connections:[]};
  const remote=createQualityTransport(async request=>{calls.push(request);return request.method==='GET'?{status:200,body:{capabilities:{forgeQuality:true}}}:{status:200,body:evidence};});
  assert.deepEqual(await remote({action:'LIST'}),evidence);
  assert.deepEqual(calls[1],{path:'/api/integrations/forge/quality',method:'POST',body:{action:'LIST'}});
  assert.equal(Object.hasOwn(calls[1],'headers'),false);
});

for (const action of ['IDENTITY','CONNECT','READ','RELEASES','READ_RELEASE','READ_CLOSURE']) test(`${action}: bridge owns JSON encoding and headers`,async()=>{
  const calls=[],body={action,connectionKey:'synthetic-only'};
  const remote=createQualityTransport(async request=>{calls.push(request);return request.method==='GET'?{status:200,body:{capabilities:{forgeQuality:true,forgeProjectConnection:true}}}:{status:200,body:{ok:true}};});
  await remote(body);
  const request=calls.at(-1);
  assert.equal(request.method,'POST');
  assert.equal(request.body,body);
  assert.equal(Object.hasOwn(request,'headers'),false);
});
test('connection handoff waits for its own API capability, not just legacy quality readiness',async()=>{
  const calls=[];
  const remote=createQualityTransport(async request=>{calls.push(request);return {status:200,body:{capabilities:{forgeQuality:true}}};});
  await assert.rejects(remote({action:'CONNECT'}),/waiting for the Vaettir API update/);
  assert.equal(calls.length,1);
});
test('controlled access failure is surfaced',async()=>{
  const remote=createQualityTransport(async()=>({status:403,body:{error:'No approved connection'}}));
  await assert.rejects(remote({action:'READ'}),/No approved connection/);
});
test('stalled request times out and a later retry can succeed',async()=>{
  let stalled=true;
  const remote=createQualityTransport(async()=>stalled?new Promise(()=>{}):{status:200,body:{ok:true}},10);
  await assert.rejects(remote({action:'READ'}),/did not respond in time/);
  stalled=false;
  assert.deepEqual(await remote({action:'READ'}),{ok:true});
});
