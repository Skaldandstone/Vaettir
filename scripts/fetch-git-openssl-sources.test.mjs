import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePins,validateSourcePins,fetchGitOpenSSLSource} from './fetch-git-openssl-sources.mjs';
test('closed component identity and deeply immutable pins',()=>{
  assert.ok(Object.isFrozen(sourcePins)&&Object.isFrozen(sourcePins.git)&&Object.isFrozen(sourcePins.git.files)&&Object.isFrozen(sourcePins.git.files[0]));
  assert.throws(()=>{sourcePins.git.files[0].name='../escape';},TypeError);
  for(const mutate of [x=>x.git.origin=x.curl.origin,x=>x.git.files[0].name='../escape',x=>x.git.files[0].name='curl_wrong.dsc',x=>x.git.extra=true,x=>x.git.files[0].maxBytes++,x=>x.git.signer='0'.repeat(40),x=>x.git.files[0].sha256='x'.repeat(64)]){const copy=structuredClone(sourcePins);mutate(copy);assert.throws(()=>validateSourcePins(copy));}
});
test('maintained signed Debian curl8.22 identity rejects historical8.21 input',()=>{
  assert.equal(sourcePins.curl.version,'8.22.0-1');assert.equal(sourcePins.curl.signer,'05DB6A837E105F4B1D02C55FBBA9FAADCCFB4707');
  assert.deepEqual(sourcePins.curl.files.map(x=>[x.name,x.sha256]),[
    ['curl_8.22.0-1.dsc','b4872ef4875931c852f0a919db53481395fad36a9c39c0a20917b8abfae9f10a'],
    ['curl_8.22.0.orig.tar.gz','d54dd598bf05927a726deb38df31c6a255ba83ff1de57c5d1464dac3ed8f44a1'],
    ['curl_8.22.0.orig.tar.gz.asc','fcd906e7d7a370e5079206b365b229fffc54b8fe311f60179ff7412e2cf77d5c'],
    ['curl_8.22.0-1.debian.tar.xz','5c20c1b4eab8a991d1a4a543d36c96c56291bf36337452756796765506b8821c']]);
  const stale=structuredClone(sourcePins);stale.curl.version='8.21.0-2~bpo13+1';assert.throws(()=>validateSourcePins(stale));
  assert.equal(sourcePins.git.version,'1:2.47.3-0+deb13u1');assert.equal(sourcePins.git.files[0].sha256,'41ee783af84774dfab31ff6af54a07f70513dd09914e2d622626f4dfecae0a86');
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
