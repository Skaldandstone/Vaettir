import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createQualityTransport} from '../integrations/atlassian/src/transport.ts';

for (const action of ['LIST','IDENTITY']) test(`${action}: old API gives actionable feedback without a POST`, async()=>{
  const calls=[];
  const remote=createQualityTransport(async request=>{calls.push(request);return {status:200,body:{status:'ok'}};});
  await assert.rejects(remote({action}),/waiting for the Vaettir API update/);
  assert.deepEqual(calls,[{path:'/api/health/detailed',method:'GET'}]);
});
test('ready API receives JSON and returns approved evidence',async()=>{
  const calls=[], evidence={connections:[]};
  const remote=createQualityTransport(async request=>{calls.push(request);return request.method==='GET'?{status:200,body:{capabilities:{forgeQuality:true}}}:{status:200,body:evidence};});
  assert.deepEqual(await remote({action:'LIST'}),evidence);
  assert.deepEqual(calls[1],{path:'/api/integrations/forge/quality',method:'POST',headers:{'Content-Type':'application/json'},body:{action:'LIST'}});
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
