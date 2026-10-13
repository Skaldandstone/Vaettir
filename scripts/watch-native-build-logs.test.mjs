import test from 'node:test';import assert from 'node:assert/strict';import{logs,requireLogState,streamLogRange,requireAggregateLogBytes}from'./watch-native-build-logs.mjs';
import{mkdtempSync,writeFileSync,appendFileSync,openSync,closeSync,rmSync,readFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
test('finite owned logs and exact append-only regular file identity, not recursive source/read scope',()=>{
 assert.equal(logs.length,9);assert.equal(new Set(logs).size,9);for(const path of logs)assert.match(path,/^(?:glibc|freetype)\/[a-z-]+\.log$/);
 const state={regular:true,symlink:false,bytes:10,dev:1,ino:2};requireLogState(undefined,state);requireLogState(state,{...state,bytes:20});
 for(const edit of [s=>s.regular=false,s=>s.symlink=true,s=>s.bytes=9,s=>s.bytes=64*1024**2+1,s=>s.dev=3,s=>s.ino=4]){const next={...state};edit(next);assert.throws(()=>requireLogState(state,next));}
});
test('combined logs admit observed package phase plus separate full checks without weakening each owned file bound',()=>{
 assert.equal(requireAggregateLogBytes(66112415,8*1024**2),66112415+8*1024**2);assert.equal(requireAggregateLogBytes(128*1024**2-1,1),128*1024**2);assert.throws(()=>requireAggregateLogBytes(128*1024**2,1));for(const n of [-1,0.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>requireAggregateLogBytes(0,n));assert.throws(()=>requireLogState(undefined,{regular:true,symlink:false,bytes:64*1024**2+1,dev:1,ino:2}));
});
test('actual file chunks stay byte-exact when a backpressured writer retains them across reads and append drains',()=>{
 const dir=mkdtempSync(join(tmpdir(),'vaettir-native-log-')),path=join(dir,'owned.log');let fd;
 try{
  const initial=Buffer.alloc(3*65536+17);for(let i=0;i<initial.length;i++)initial[i]=(i*19+Math.floor(i/65536))%256;
  writeFileSync(path,initial,{flag:'wx'});fd=openSync(path,'r');const pending=[];
  assert.equal(streamLogRange(fd,0,initial.length,chunk=>{pending.push(chunk);return false;}),initial.length);
  const appended=Buffer.from('original append\n\0\xff','latin1');appendFileSync(path,appended);
  assert.equal(streamLogRange(fd,initial.length,initial.length+appended.length,chunk=>pending.push(chunk)),appended.length);
  assert.deepEqual(Buffer.concat(pending),readFileSync(path));assert.deepEqual(pending[0],initial.subarray(0,65536));
  assert.equal(streamLogRange(fd,0,0,()=>assert.fail('empty range emitted bytes')),0);
  for(const [start,end]of[[-1,1],[2,1],[0,64*1024**2+1],[0,initial.length+appended.length+1]])assert.throws(()=>streamLogRange(fd,start,end,()=>{}));
 }finally{if(fd!==undefined)closeSync(fd);rmSync(dir,{recursive:true});}
});
