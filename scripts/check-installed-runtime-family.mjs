// Verify sealed native-package counterparts in the immutable candidate image.
// Does not install, fetch, alter dpkg state, or perform source/provider reads.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
assert.equal(process.argv.length,4,'Supply exact api/web image kind and sealed runtime proof directory');
const kind=process.argv[2];assert.ok(['api','web'].includes(kind));
// FreeType is an existing API package, not a Web package. Do not introduce it
// into Web just to satisfy an API-only counterpart proof.
const components=kind==='api'?['glibc','freetype']:['glibc'];
const proof=process.argv[3];assert.match(proof,/^\/usr\/share\/vaettir\/runtime-security\/[^.][A-Za-z0-9_-]*$/);
const installed=execFileSync('dpkg-query',['-W','-f=${Package}\t${Version}\t${source:Package}\t${db:Status-Status}\n'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
const rows=installed.trim().split('\n').map(line=>{const [name,version,source,status]=line.split('\t');return {name,version,source,status};});
for(const component of components){
  const inventory=JSON.parse(readFileSync(join(proof,component+'-package-inventory.json'),'utf8'));
  assert.equal(inventory.component,component);assert.equal(inventory.version,component==='glibc'?'2.41-12+deb13u4+vaettir1':'2.13.3+dfsg-1+deb13u1+vaettir1');
  const present=rows.filter(row=>row.source===component&&row.status==='installed');assert.ok(present.length>0);
  if(component==='glibc'){assert.ok(present.some(row=>row.name==='libc6'));assert.ok(present.some(row=>row.name==='libc-bin'));}
  for(const row of present){assert.equal(row.version,inventory.version,'Mixed maintained/runtime family: '+row.name);assert.ok(inventory.rows.some(candidate=>candidate.package===row.name&&candidate.version===row.version),'Installed family member absent from sealed build: '+row.name);}
}
for(const component of components){
const artifacts=JSON.parse(readFileSync(join(proof,component+'-installed-elf-inventory.json'),'utf8'));
assert.equal(artifacts.version,'runtime-installed-elf/v1');assert.equal(artifacts.component,component);assert.ok(artifacts.rows.length>0&&artifacts.rows.length<=512);
for(const artifact of artifacts.rows){
  assert.match(artifact.path,/^\/(?:usr\/)?lib(?:64)?\/[A-Za-z0-9_./+-]+$/);assert.ok(!artifact.path.split('/').includes('..'));assert.match(artifact.sha256,/^[a-f0-9]{64}$/);
  const actual=realpathSync(artifact.path);assert.ok(lstatSync(actual).isFile());assert.equal(hash(readFileSync(actual)),artifact.sha256,'Installed family bytes differ from admitted ABI artifact');
}
}
console.log('Installed glibc/FreeType families match sealed versions and ELF bytes; CID/security/runtime acceptance still independent.');
