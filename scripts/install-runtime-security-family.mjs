// Container-build-only counterpart installation. Never runs on a live service,
// creates credentials, fetches packages, or adds a new package to the cohort.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const versions={glibc:'2.41-12+deb13u4',freetype:'2.13.3+dfsg-1+deb13u1'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function planRuntimeCounterparts(kind,current,inventories){
 assert.ok(['api','web'].includes(kind));assert.ok(Array.isArray(current)&&current.length<=1000);
 const expected=kind==='api'?['libc-bin','libc6','libfreetype6']:['libc-bin','libc6'];
 const components=kind==='api'?['glibc','freetype']:['glibc'];
 const family=current.filter(row=>row.status==='installed'&&['glibc','freetype'].includes(row.source));
 assert.deepEqual(family.map(row=>row.name).sort(),expected,'Original runtime family changed; do not introduce or omit a counterpart');
 const planned=[];
 for(const component of components){
  const inventory=inventories[component];assert.equal(inventory.component,component);assert.equal(inventory.version,versions[component]+'+vaettir1');
  assert.ok(Array.isArray(inventory.rows)&&inventory.rows.length>0&&inventory.rows.length<=32);
  assert.equal(new Set(inventory.rows.map(row=>row.package)).size,inventory.rows.length);
  for(const original of family.filter(row=>row.source===component)){
   assert.equal(original.version,versions[component],'Original maintained source version drifted; no downgrade permitted');
   const counterpart=inventory.rows.find(row=>row.package===original.name);
   assert.ok(counterpart);assert.equal(counterpart.version,inventory.version);assert.equal(counterpart.architecture,'amd64');
   assert.match(counterpart.name,/^[a-z0-9][a-z0-9+.-]*_[A-Za-z0-9+.~-]+_amd64\.deb$/);assert.ok(!counterpart.name.includes('..'));
   assert.match(counterpart.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(counterpart.bytes)&&counterpart.bytes>0&&counterpart.bytes<=20000000);
   planned.push({...counterpart,component,originalVersion:original.version});
  }
 }
 return planned;
}
function run(args){return execFileSync(args[0],args.slice(1),{encoding:'utf8',timeout:30000,maxBuffer:2000000,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.argv.length,6);
 assert.equal(process.argv[2],'--image-build');
 // Existing build-only read-only script mount, unavailable in live tasks.
 assert.equal(sha(readFileSync('/run/vaettir-image-build/install-runtime-security-family.mjs')),sha(readFileSync(new URL(import.meta.url))));
 const[kind,packages,proof]=process.argv.slice(3);assert.ok(['api','web'].includes(kind));
 assert.equal(packages,'/tmp/vaettir-runtime-security');assert.equal(proof,'/usr/share/vaettir/runtime-security/maintained');
 const components=kind==='api'?['glibc','freetype']:['glibc'];
 const raw=run(['dpkg-query','-W','-f=${Package}\t${Version}\t${source:Package}\t${db:Status-Status}\n']);
 const current=raw.trim().split('\n').map(line=>{const[name,version,source,status]=line.split('\t');return{name,version,source,status};});
 const inventories=Object.fromEntries(components.map(component=>[component,JSON.parse(readFileSync(join(proof,component+'-package-inventory.json'),'utf8'))]));
 const plan=planRuntimeCounterparts(kind,current,inventories),files=[];
 for(const item of plan){
  const file=join(packages,item.name),stat=lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
  const bytes=readFileSync(file);assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);
  assert.equal(run(['dpkg-deb','-f',file,'Package']).trim(),item.package);assert.equal(run(['dpkg-deb','-f',file,'Version']).trim(),item.version);assert.equal(run(['dpkg-deb','-f',file,'Architecture']).trim(),item.architecture);files.push(file);
 }
 const receipt=join(proof,'installed-family-'+kind+'.json');
 writeFileSync(receipt+'.intent',JSON.stringify({kind,originalDpkgStatusSha256:sha(raw),plan,installedAcceptance:false},null,2)+'\n',{flag:'wx'});
 run(['dpkg','--install',...files]);assert.equal(run(['dpkg','--audit']).trim(),'');
 const after=run(['dpkg-query','-W','-f=${Package}\t${Version}\t${source:Package}\t${db:Status-Status}\n']);
 for(const item of plan)assert.ok(after.split('\n').includes([item.package,item.version,item.component,'installed'].join('\t')));
 writeFileSync(receipt,JSON.stringify({kind,originalDpkgStatusSha256:sha(raw),installedDpkgStatusSha256:sha(after),plan,packageCounterpartsInstalled:true,elfAndNativeAcceptance:false,securityAcceptance:false},null,2)+'\n',{flag:'wx'});
 for(const file of files)unlinkSync(file);
 console.log('Exact original runtime package counterparts installed; ELF/native/full-image/security gates remain required.');
}
