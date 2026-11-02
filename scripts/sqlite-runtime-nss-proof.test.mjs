import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './sqlite-runtime-nss-proof.cjs';
const paths=Object.keys(fixture.EXPECTED),text=paths.map(p=>`42: calling init: ${p}`).join('\n');
const hash=p=>fixture.EXPECTED[p];
test('requires actual loader initialization for every exact NSS and SQLite library',()=>{
  assert.equal(fixture.requireLoadedLibraries(text,p=>p,hash).length,3);
  assert.throws(()=>fixture.requireLoadedLibraries(text.replace('calling init:','find library='),p=>p,hash),/missing/);
  assert.throws(()=>fixture.requireLoadedLibraries(text,p=>p,()=> 'a'.repeat(64)),/changed/);
});
test('aliases must resolve to the exact reviewed runtime, never another same-name library',()=>{
  const aliased=text.replaceAll('/usr/lib/','/lib/');
  assert.equal(fixture.requireLoadedLibraries(aliased,p=>p.replace('/lib/','/usr/lib/'),hash).length,3);
  assert.throws(()=>fixture.requireLoadedLibraries(text.replace('/usr/lib/x86_64-linux-gnu/libsoftokn3.so','/tmp/libsoftokn3.so'),p=>p,hash));
  assert.throws(()=>fixture.requireLoadedLibraries(text,p=>p.replace('libsoftokn3.so','other.so'),hash),/Unexpected/);
});
test('zero exit or a hashed unused file cannot substitute loader and native success evidence',()=>{
  assert.throws(()=>fixture.requireLoadedLibraries('hashed expected files; find library=libsqlite3.so.0',p=>p,hash),/missing/);
  fixture.requireChild({status:0,signal:null,error:null});
  for(const r of [{status:null,signal:null,error:'EACCES'},{status:0,signal:'SIGTERM',error:null},{status:1,signal:null,error:null}])assert.throws(()=>fixture.requireChild(r));
});
test('real bounded SQLite file headers are required instead of existence-only assertions',()=>{
  fixture.sqliteHeader(Buffer.concat([Buffer.from('SQLite format 3'),Buffer.from([0])]));
  for(const bytes of [Buffer.alloc(0),Buffer.from('SQLite format 3!'),Buffer.alloc(16)])assert.throws(()=>fixture.sqliteHeader(bytes));
});
