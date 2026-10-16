import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {planExpatReplacement,assertUnchangedOtherPackages} from './install-expat-runtime.mjs';
const before=[{name:'libexpat1',version:'2.8.5-2',source:'expat',status:'installed'},{name:'libc6',version:'retained',source:'glibc',status:'installed'}];
const proof={version:'2.9.0-1',package:'libexpat1',architecture:'amd64',completeLayersVerified:true,completeSourceClosureVerified:true,maintainerSignatureVerified:true,narrowAndWideBufferRegressionsPassed:true,wideUtf16AbiRegressionPassed:true,runtimeEligible:false,packageSha256:'a'.repeat(64),digest:'sha256:'+'b'.repeat(64),sourceCommit:'c'.repeat(40)};
test('exact existing Expat family requires full independently bound source and real build proofs',()=>{
  const plan=planExpatReplacement(before,proof);assert.equal(plan.beforeVersion,'2.8.5-2');assert.equal(plan.version,'2.9.0-1');assert.equal(plan.sha256,proof.packageSha256);
  for(const key of ['completeLayersVerified','completeSourceClosureVerified','maintainerSignatureVerified','narrowAndWideBufferRegressionsPassed','wideUtf16AbiRegressionPassed'])assert.throws(()=>planExpatReplacement(before,{...proof,[key]:false}));
  for(const change of [{version:'2.8.5-2'},{architecture:'i386'},{package:'expat'},{runtimeEligible:true},{packageSha256:'unknown'},{sourceCommit:'uncommitted'}])assert.throws(()=>planExpatReplacement(before,{...proof,...change}));
});
test('extra, missing, altered, non-installed or duplicate counterparts are never admitted',()=>{
  for(const rows of [[],before.slice(1),[...before,before[0]],[{...before[0],version:'2.8.3'},before[1]],[{...before[0],status:'not-installed'},before[1]],[...before,{name:'expat',version:'2.8.5-2',source:'expat',status:'installed'}]])assert.throws(()=>planExpatReplacement(rows,proof));
});
test('post-install checks preserve all other package rows and require exact installed upgrade',()=>{
  const after=[{...before[0],version:'2.9.0-1'},before[1]];assertUnchangedOtherPackages(before,after);
  assert.throws(()=>assertUnchangedOtherPackages(before,[after[0],{...before[1],version:'changed'}]));
  assert.throws(()=>assertUnchangedOtherPackages(before,after.slice(0,1)));
  assert.throws(()=>assertUnchangedOtherPackages(before,before));
});
test('installer is offline and requires original verified read-only build source before package commands',()=>{
  const code=readFileSync(new URL('./install-expat-runtime.mjs',import.meta.url),'utf8');
  assert.ok(code.indexOf('assertReadOnlyBuildSource();')<code.indexOf("run(['dpkg','--install',file])"));
  assert.match(code,/platform,'linux'/);assert.match(code,/getuid\(\),0/);assert.match(code,/cwd\(\),'\/app'/);
  assert.doesNotMatch(code,/apt-get|--force|allow-unauthenticated|trusted=yes|fetch\(/);
});
