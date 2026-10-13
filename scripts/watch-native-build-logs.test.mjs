import test from 'node:test';import assert from 'node:assert/strict';import{logs,requireLogState}from'./watch-native-build-logs.mjs';
test('finite owned logs and exact append-only regular file identity, not recursive source/read scope',()=>{
 assert.equal(logs.length,9);assert.equal(new Set(logs).size,9);for(const path of logs)assert.match(path,/^(?:glibc|freetype)\/[a-z-]+\.log$/);
 const state={regular:true,symlink:false,bytes:10,dev:1,ino:2};requireLogState(undefined,state);requireLogState(state,{...state,bytes:20});
 for(const edit of [s=>s.regular=false,s=>s.symlink=true,s=>s.bytes=9,s=>s.bytes=64*1024**2+1,s=>s.dev=3,s=>s.ino=4]){const next={...state};edit(next);assert.throws(()=>requireLogState(state,next));}
});
