// Offline, build-context-only replacement of the already installed Expat
// family. Package installation is not ABI, native, security or deploy acceptance.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync,lstatSync,writeFileSync,unlinkSync} from "node:fs";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {assertReadOnlyBuildSource} from "./prune-runtime-package-manager.mjs";
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function planExpatReplacement(current,proof) {
  assert.ok(Array.isArray(current)&&current.length>0&&current.length<=1000);
  assert.equal(new Set(current.map(row=>row.name)).size,current.length);
  const family=current.filter(row=>row.source==='expat'&&row.status==='installed');
  assert.equal(family.length,1,'Do not introduce or omit an Expat counterpart');
  assert.deepEqual(family[0],{name:'libexpat1',version:'2.8.5-2',source:'expat',status:'installed'});
  assert.equal(proof.version,'2.9.0-1');assert.equal(proof.package,'libexpat1');assert.equal(proof.architecture,'amd64');
  assert.equal(proof.completeLayersVerified,true);assert.equal(proof.completeSourceClosureVerified,true);assert.equal(proof.maintainerSignatureVerified,true);assert.equal(proof.narrowAndWideBufferRegressionsPassed,true);assert.equal(proof.wideUtf16AbiRegressionPassed,true);assert.equal(proof.runtimeEligible,false);
  assert.match(proof.packageSha256,/^[a-f0-9]{64}$/);assert.match(proof.digest,/^sha256:[a-f0-9]{64}$/);assert.match(proof.sourceCommit,/^[a-f0-9]{40}$/);
  return {name:'libexpat1',source:'expat',beforeVersion:family[0].version,version:proof.version,architecture:proof.architecture,sha256:proof.packageSha256,proofDigest:proof.digest,proofSourceCommit:proof.sourceCommit};
}
export function assertUnchangedOtherPackages(before,after) {
  assert.equal(before.length,after.length);
  const other=rows=>rows.filter(row=>row.name!=='libexpat1').sort((a,b)=>a.name.localeCompare(b.name));
  assert.deepEqual(other(after),other(before),'Non-Expat package changed');
  assert.deepEqual(after.filter(row=>row.name==='libexpat1'),[{name:'libexpat1',version:'2.9.0-1',source:'expat',status:'installed'}]);
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  assert.deepEqual(process.argv.slice(2),['--image-build']);assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.cwd(),'/app');
  assertReadOnlyBuildSource();
  assert.equal(sha(readFileSync('/run/vaettir-image-build/install-expat-runtime.mjs')),sha(readFileSync(new URL(import.meta.url))));
  const file='/tmp/vaettir-expat/libexpat1_2.9.0-1_amd64.deb',proofPath='/usr/share/vaettir/expat-290/package-proof.json';
  for(const path of [file,proofPath]) {const stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.ok(stat.size>0&&stat.size<2*1024**2);}
  const proof=JSON.parse(readFileSync(proofPath,'utf8'));
  const run=args=>execFileSync(args[0],args.slice(1),{encoding:'utf8',timeout:90000,maxBuffer:2*1024**2,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});
  const query=()=>run(['dpkg-query','-W','-f=${Package}\t${Version}\t${source:Package}\t${db:Status-Status}\n']);
  const parse=raw=>raw.trim().split('\n').map(line=>{const[name,version,source,status]=line.split('\t');return{name,version,source,status};});
  const beforeRaw=query(),before=parse(beforeRaw),plan=planExpatReplacement(before,proof);
  assert.equal(sha(readFileSync(file)),plan.sha256);
  for(const [field,value] of [['Package',plan.name],['Version',plan.version],['Architecture',plan.architecture]])assert.equal(run(['dpkg-deb','-f',file,field]).trim(),value);
  const ownedBefore=run(['dpkg-query','-L','libexpat1']).trim().split('\n');
  const destination='/usr/share/vaettir/expat-290/installed-family.json';
  writeFileSync(destination+'.intent',JSON.stringify({plan,originalDpkgQuerySha256:sha(beforeRaw),ownedBefore,installedAcceptance:false},null,2)+'\n',{flag:'wx'});
  run(['dpkg','--install',file]);assert.equal(run(['dpkg','--audit']).trim(),'');
  const afterRaw=query(),after=parse(afterRaw);assertUnchangedOtherPackages(before,after);
  const ownedAfter=run(['dpkg-query','-L','libexpat1']).trim().split('\n');
  writeFileSync(destination,JSON.stringify({plan,originalDpkgQuerySha256:sha(beforeRaw),installedDpkgQuerySha256:sha(afterRaw),ownedBefore,ownedAfter,onlyOriginalPackageReplaced:true,packageCounterpartInstalled:true,elfAndNativeAcceptance:false,securityAcceptance:false,deployed:false},null,2)+'\n',{flag:'wx'});
  unlinkSync(file);
  console.log('Original Expat counterpart upgraded offline; complete ELF/native/security gates remain required.');
}
