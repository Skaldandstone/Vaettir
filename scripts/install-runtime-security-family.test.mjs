import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planRuntimeCounterparts} from './install-runtime-security-family.mjs';
const old={glibc:'2.41-12+deb13u4',freetype:'2.13.3+dfsg-1+deb13u1'};
const rows=[['libc-bin','glibc'],['libc6','glibc'],['libfreetype6','freetype']].map(([name,source])=>({name,source,version:old[source],status:'installed'}));
const inventories=Object.fromEntries(Object.keys(old).map(component=>[component,{component,version:old[component]+'+vaettir1',rows:rows.filter(row=>row.source===component).map(row=>({name:row.name+'_'+old[component]+'+vaettir1_amd64.deb',package:row.name,architecture:'amd64',version:old[component]+'+vaettir1',bytes:100,sha256:'a'.repeat(64)}))}]));
test('exact original libc-bin/libc6 pair and API-only FreeType, not a new package cohort',()=>{
 assert.deepEqual(planRuntimeCounterparts('api',rows,inventories).map(row=>row.package).sort(),['libc-bin','libc6','libfreetype6']);
 assert.deepEqual(planRuntimeCounterparts('web',rows.slice(0,2),inventories).map(row=>row.package).sort(),['libc-bin','libc6']);
 for(const current of [rows.slice(1),[...rows,{...rows[0],name:'libc6-dev'}],rows.map(row=>({...row,version:row.version+'-new'}))])assert.throws(()=>planRuntimeCounterparts('api',current,inventories));
 assert.throws(()=>planRuntimeCounterparts('web',rows,inventories));
});
test('changed package identity, mixed version, duplicate, missing, foreign architecture and unsafe artifact paths refuse',()=>{
 for(const field of ['version','architecture','name','sha256','bytes']){const bad=structuredClone(inventories);bad.glibc.rows[0][field]=field==='bytes'?0:'../unapproved';assert.throws(()=>planRuntimeCounterparts('api',rows,bad));}
 const missing=structuredClone(inventories);missing.glibc.rows.shift();assert.throws(()=>planRuntimeCounterparts('api',rows,missing));
 const duplicate=structuredClone(inventories);duplicate.glibc.rows.push(duplicate.glibc.rows[0]);assert.throws(()=>planRuntimeCounterparts('api',rows,duplicate));
});
test('operative installation requires the established build-only matching script mount before any package mutation',()=>{
 const source=readFileSync(new URL('./install-runtime-security-family.mjs',import.meta.url),'utf8');
 assert.match(source,/assert.equal\(process.argv\[2\],'--image-build'\)/);
 assert.ok(source.indexOf('/run/vaettir-image-build/install-runtime-security-family.mjs')<source.indexOf("run(['dpkg','--install'"));
});
