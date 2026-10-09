import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePins,validateSourcePins,fetchGitOpenSSLSource} from './fetch-git-openssl-sources.mjs';
test('closed component identity and deeply immutable pins',()=>{
  assert.ok(Object.isFrozen(sourcePins)&&Object.isFrozen(sourcePins.git)&&Object.isFrozen(sourcePins.git.files)&&Object.isFrozen(sourcePins.git.files[0]));
  assert.throws(()=>{sourcePins.git.files[0].name='../escape';},TypeError);
  for(const mutate of [x=>x.git.origin=x.curl.origin,x=>x.git.files[0].name='../escape',x=>x.git.files[0].name='curl_wrong.dsc',x=>x.git.extra=true,x=>x.git.files[0].maxBytes++,x=>x.git.signer='0'.repeat(40),x=>x.git.files[0].sha256='x'.repeat(64)]){const copy=structuredClone(sourcePins);mutate(copy);assert.throws(()=>validateSourcePins(copy));}
});
test('unknown component and unsafe names never reach transport',async()=>{
  let calls=0;const fetchImpl=()=>{calls++;throw Error('private transport detail');};
  for(const [component,name] of [['other','git_x'],['git','../git_x'],['git','curl_x'],['git','git_unknown']])await assert.rejects(fetchGitOpenSSLSource(component,name,{fetchImpl}));
  assert.equal(calls,0);
});
test('transport, integrity and byte bounds reject without accepting source',async()=>{
  const name=sourcePins.git.files[0].name;
  await assert.rejects(fetchGitOpenSSLSource('git',name,{fetchImpl:async()=>{throw Error('secret URL');}}),/source transport failed/);
  await assert.rejects(fetchGitOpenSSLSource('git',name,{fetchImpl:async(url,options)=>{assert.equal(url,sourcePins.git.origin+name);assert.equal(options.redirect,'error');return {ok:true,body:[Buffer.from('wrong')]};}}),/hash mismatch/);
  await assert.rejects(fetchGitOpenSSLSource('git',name,{fetchImpl:async()=>({ok:true,body:[Buffer.alloc(10001)]})}),/bound exceeded/);
});
