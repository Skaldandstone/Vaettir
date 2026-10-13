import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {requireSourceManifest,requireSignature,requireTestSummary,requiredExtendedTest,requireExtendedTestResult,nativeFailureEvidence,nativeFailureFrames,emitNativeFailureEvidence,requiredPassExpectations,nativeRequiredPassMakeFlags,parseDynSymbols,requireAbiPreservation,requireFreeTypeStandardResult} from './runtime-build-proof.mjs';
const manifest=readFileSync(new URL('./runtime-security-sources.json',import.meta.url));
test('exact reviewed maintained source manifest admits 10 sources/23 ordered official patches and refuses changed custody',()=>{
  const value=requireSourceManifest(manifest);assert.equal(value.components.glibc.patches.length,22);assert.equal(value.components.freetype.patches.length,1);assert.throws(()=>requireSourceManifest(Buffer.concat([manifest,Buffer.from(' ')])));
});
test('exact original signer/primary only, no expired/revoked or additional signatures',()=>{
  const component=requireSourceManifest(manifest).components.glibc;
  const line=`[GNUPG:] VALIDSIG ${component.signer} 2026-10-12 1 0 4 0 1 10 00 ${component.primarySigner}\n`;
  requireSignature(line,component);for(const bad of ['EXPKEYSIG','EXPSIG','KEYEXPIRED','REVKEYSIG','BADSIG','ERRSIG','NO_PUBKEY'])assert.throws(()=>requireSignature(line+`[GNUPG:] ${bad} key\n`,component));assert.throws(()=>requireSignature(line+line,component));assert.throws(()=>requireSignature(line.replace(component.primarySigner,'A'.repeat(40)),component));
});
const names=['resolv/tst-ns_sprintrr','posix/tst-wordexp-tilde','posix/tst-wordexp-append','stdlib/tst-strfmon-bug34510','iconvdata/tst-jisx0213-progress','libio/tst-fopen-ccs-empty','elf/tst-dl-path-normalize','elf/tst-origin-secure'];
const summary='\t\t=== glibc tests ===\n'+['.','elf','nptl','stdlib','string','math','iconvdata','posix','resolv','libio','conform'].map(name=>'Running '+name+' ...\n').join('')+[...names,...requiredPassExpectations].map(name=>'PASS: '+name+'\n').join('');
test('exact ten recorded expected-failure allowances are removed, not replaced by skips or relabeled results',()=>{
 assert.equal(requiredPassExpectations.length,10);assert.equal(new Set(requiredPassExpectations).size,10);assert.equal(nativeRequiredPassMakeFlags(),requiredPassExpectations.map(name=>'test-xfail-'+name.split('/')[1]+'=').join(' '));assert.doesNotMatch(nativeRequiredPassMakeFlags(),/yes|no|skip|nocheck/);
 for(const name of requiredPassExpectations){assert.throws(()=>requireTestSummary(summary.replace('PASS: '+name+'\n','XFAIL: '+name+'\n')));assert.throws(()=>requireTestSummary(summary.replace('PASS: '+name+'\n','')));}
 const shell=readFileSync(new URL('./build-maintained-runtime.sh',import.meta.url),'utf8');assert.equal(shell.match(/MAKEFLAGS="\$required_pass_flags"/g).length,3);assert.match(shell,/dpkg-buildpackage -b -us -uc/);assert.match(shell,/check-abi/);
});

test('official xtest requires its separate genuine PASS bytes, never a forged standard-summary row or a skipped status',()=>{
 assert.equal(requiredExtendedTest,'string/test-strncasecmp-nonarray');
 assert.ok(!requireTestSummary(summary).records.some(row=>row.name===requiredExtendedTest));
 const output=Buffer.from('info: testing strncasecmp\n'),result='PASS: '+requiredExtendedTest+'\noriginal exit status 0\n';
 const proof=requireExtendedTestResult(result,output);assert.equal(proof.status,'PASS');assert.equal(proof.name,requiredExtendedTest);assert.equal(proof.outputBytes,output.length);
 for(const status of ['FAIL','XPASS','XFAIL','UNSUPPORTED','ERROR','UNRESOLVED'])assert.throws(()=>requireExtendedTestResult(result.replace('PASS:',status+':'),output));
 for(const text of ['',result.replace(requiredExtendedTest,'string/other'),result+'FAIL: string/other\n',result.replace('status 0','status 1'),result.replace('status 0','status 77')])assert.throws(()=>requireExtendedTestResult(text,output));
 for(const bytes of [Buffer.alloc(0),Buffer.alloc(128*1024+1)])assert.throws(()=>requireExtendedTestResult(result,bytes));
 const shell=readFileSync(new URL('./build-maintained-runtime.sh',import.meta.url),'utf8'),validator=readFileSync(new URL('./runtime-build-proof.mjs',import.meta.url),'utf8');
 assert.ok(shell.includes('test ! -e "$build_dir/string/test-strncasecmp-nonarray.out"'));
 assert.ok(shell.includes('test ! -e "$build_dir/string/test-strncasecmp-nonarray.test-result"'));
 assert.ok(shell.includes('test t=string/test-strncasecmp-nonarray > "$root/extended-regression.log"'));
 assert.ok(validator.includes('requiredExtendedTests:[extended]'));
 assert.ok(validator.includes('readFileSync(copiedResult).equals(rawExtendedResult)'));
 assert.ok(validator.includes('readFileSync(copiedOutput).equals(rawExtendedOutput)'));
 assert.ok(validator.includes('for(const file of [extendedResult,extendedOutput,extendedBinary])regular(file)'));
 assert.doesNotMatch(shell,/echo.*PASS:|printf.*PASS:|>>.*tests\.sum/);
});
test('real GNU make propagates empty required-PASS overrides through maintained-style parent and submake',t=>{
 const version=spawnSync('make',['--version'],{encoding:'utf8',timeout:10000});if(version.error?.code==='ENOENT'&&process.platform==='win32'){t.skip('GNU make is not installed on Windows; the required actual propagation check runs on Linux CI');return;}assert.equal(version.status,0);assert.match(version.stdout,/GNU Make/);
 const dir=mkdtempSync(join(tmpdir(),'vaettir-required-pass-'));try{
  const assignments=requiredPassExpectations.map(name=>'test-xfail-'+name.split('/')[1]+' = yes').join('\n'),checks=requiredPassExpectations.map(name=>'\t@test -z "$(test-xfail-'+name.split('/')[1]+')"').join('\n');
  writeFileSync(join(dir,'child.mk'),assignments+'\nall:\n'+checks+'\n\t@echo EXACT_EMPTY_SUBMAKE_EXPECTATIONS\n');writeFileSync(join(dir,'parent.mk'),assignments+'\nall:\n'+checks+'\n\t@$(MAKE) -f child.mk all\n');
  const actual=spawnSync('make',['-f','parent.mk','all'],{cwd:dir,encoding:'utf8',timeout:10000,env:{...process.env,MAKEFLAGS:nativeRequiredPassMakeFlags()}});assert.equal(actual.status,0,actual.stderr);assert.match(actual.stdout,/EXACT_EMPTY_SUBMAKE_EXPECTATIONS/);
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.match(basename(dir),/^vaettir-required-pass-[A-Za-z0-9]+$/);rmSync(dir,{recursive:true});}
});
test('full-suite model admits official regressions, preserves XFAIL/UNSUPPORTED, refuses FAIL/XPASS/ERROR/UNRESOLVED/missing directories',()=>{
  const proof=requireTestSummary(summary+'XFAIL: nptl/expected\nUNSUPPORTED: elf/privileged\n');assert.equal(proof.counts.XFAIL,1);assert.equal(proof.counts.UNSUPPORTED,1);
  for(const status of ['FAIL','XPASS','ERROR','UNRESOLVED','UNKNOWN'])assert.throws(()=>requireTestSummary(summary+status+': elf/failure\n'));assert.throws(()=>requireTestSummary(summary.replace('Running nptl ...\n','')));assert.throws(()=>requireTestSummary(summary.replace('PASS: '+names[0],'UNSUPPORTED: '+names[0])));assert.throws(()=>requireTestSummary(summary+'PASS: '+names[0]+'\n'));
});
test('failed native summary and exact output bytes survive diagnostic serialization without changing rejection',()=>{
 const bytes=Buffer.from(summary+'FAIL: elf/real-failure\nXPASS: nptl/unexpected\nERROR: test results for directory missing\n'),binary=Buffer.from([0,255,10,13,65]),requested=[];
 const evidence=nativeFailureEvidence(bytes,path=>{requested.push(path);return binary;});assert.equal(evidence.nativeTestsAccepted,false);assert.deepEqual(Buffer.from(evidence.summary.base64,'base64'),bytes);assert.equal(evidence.issues.length,3);assert.equal(evidence.files.length,4);for(const row of evidence.files)assert.deepEqual(Buffer.from(row.base64,'base64'),binary);assert.ok(!requested.some(path=>path.includes('directory')));assert.throws(()=>requireTestSummary(bytes.toString('utf8')));
});
test('failure diagnostics never read traversal paths and keep finite original byte bounds explicit',()=>{
 const requested=[],unsafe=Buffer.from('FAIL: ../private\nFAIL: a//b\nFAIL: /absolute\nFAIL: a/./b\n');const result=nativeFailureEvidence(unsafe,path=>{requested.push(path);return Buffer.from('x');});assert.equal(requested.length,0);assert.equal(result.issues.length,4);
 const large=Buffer.alloc(512*1024+1,32);const withheld=nativeFailureEvidence(large);assert.equal(withheld.summary.base64,undefined);assert.equal(withheld.summary.bytes,large.length);assert.match(withheld.summary.withheld,/exceeds/);
 const many=Buffer.from(Array.from({length:10},(_,i)=>'FAIL: elf/failure-'+i+'\n').join(''));const bounded=nativeFailureEvidence(many,()=>Buffer.alloc(128*1024));assert.ok(bounded.payloadBytes<=1024**2);assert.ok(bounded.withheld.length>0);assert.equal(bounded.nativeTestsAccepted,false);assert.throws(()=>requireTestSummary(many.toString('utf8')));
});
const hash=b=>createHash('sha256').update(b).digest('hex');
function decodeFrames(raw){
 const lines=raw.toString('utf8').split('\n'),manifest=JSON.parse(lines.find(x=>x.startsWith('NATIVE_TEST_FAILURE_MANIFEST=')).slice('NATIVE_TEST_FAILURE_MANIFEST='.length));
 const frames=lines.filter(x=>x.startsWith('NATIVE_TEST_FAILURE_CHUNK=')).map(x=>JSON.parse(x.slice('NATIVE_TEST_FAILURE_CHUNK='.length)));assert.equal(frames.length,manifest.chunks);
 const chunks=frames.map((frame,index)=>{assert.equal(frame.index,index);const b=Buffer.from(frame.base64,'base64');assert.equal(b.length,frame.bytes);assert.equal(hash(b),frame.sha256);return b;});const bytes=Buffer.concat(chunks);assert.equal(bytes.length,manifest.bytes);assert.equal(hash(bytes),manifest.sha256);return JSON.parse(bytes);
}
test('bounded awaited failure frames survive partial writes and retain exact original rejection',async()=>{
 const evidence=nativeFailureEvidence(Buffer.from(summary+'FAIL: elf/actual\n'),()=>Buffer.alloc(128*1024,65)),frames=nativeFailureFrames(evidence),saved=[];
 assert.ok(frames.every(b=>b.length<=4096));assert.ok(frames[1].toString().startsWith('NATIVE_TEST_FAILURE_ISSUE='));
 await emitNativeFailureEvidence(evidence,b=>{const n=Math.min(19,b.length);saved.push(Buffer.from(b.subarray(0,n)));return n;});assert.deepEqual(decodeFrames(Buffer.concat(saved)),evidence);await assert.rejects(emitNativeFailureEvidence(evidence,()=>0));assert.throws(()=>requireTestSummary(Buffer.from(evidence.summary.base64,'base64').toString('utf8')));
});
test('real piped child retains more than 64KiB of exact diagnostics before its original fatal exception',()=>{
 const program=`import {nativeFailureEvidence,emitNativeFailureEvidence} from ${JSON.stringify(new URL('./runtime-build-proof.mjs',import.meta.url).href)};const summary=Buffer.from('PASS: elf/retained\\n'.repeat(18000)+'FAIL: elf/actual\\n');await emitNativeFailureEvidence(nativeFailureEvidence(summary,()=>Buffer.alloc(128*1024,65)));throw Error('ORIGINAL_NATIVE_FAILURE_REMAINS');`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:null,maxBuffer:4*1024**2,timeout:10000});assert.equal(child.status,1);assert.equal(child.signal,null);assert.match(child.stderr.toString('utf8'),/ORIGINAL_NATIVE_FAILURE_REMAINS/);assert.ok(child.stderr.length>64*1024);
 const evidence=decodeFrames(child.stderr);assert.equal(evidence.nativeTestsAccepted,false);assert.deepEqual(evidence.issues,['FAIL: elf/actual']);assert.equal(Buffer.from(evidence.summary.base64,'base64').length,18000*'PASS: elf/retained\n'.length+'FAIL: elf/actual\n'.length);assert.equal(evidence.files.length,2);assert.ok(evidence.files.every(x=>Buffer.from(x.base64,'base64').equals(Buffer.alloc(128*1024,65))));
});
const symbols='Symbol table .dynsym:\n 1: 00000010 8 OBJECT GLOBAL DEFAULT 12 exported@@GLIBC_2.2.5\n 2: 00000000 4 TLS GLOBAL DEFAULT 14 tls@GLIBC_2.34\n 3: 00000030 42 FUNC WEAK DEFAULT 12 function@@GLIBC_2.41\n 4: 00000000 0 FUNC GLOBAL DEFAULT UND dependency@GLIBC_2.2.5 (1)\n';
test('exact versioned exports include default/nondefault ABI and OBJECT/TLS sizes, not code addresses or FUNC sizes',()=>{
  const old=parseDynSymbols(symbols);assert.equal(old.length,3);requireAbiPreservation(old,old.map(row=>({...row,address:'abcd',size:row.type==='FUNC'?84:row.size})));
  for(const index of [0,1])assert.throws(()=>requireAbiPreservation(old,old.map((row,i)=>({...row,size:i===index?row.size+1:row.size}))));assert.throws(()=>requireAbiPreservation(old,old.slice(1)));assert.throws(()=>requireAbiPreservation(old,old.map(row=>({...row,name:row.name.replace('@@','@')}))));assert.throws(()=>requireAbiPreservation(old,old.map(row=>({...row,type:'FUNC'}))));
});
test('candidate retains aggregate budget, unprivileged native full check, maintained quilt and no weakened tests/options',()=>{
  const shell=readFileSync(new URL('./build-maintained-runtime.sh',import.meta.url),'utf8');assert.match(shell,/deadline=\$\(\(started \+ 3500\)\)/);assert.match(shell,/native_jobs=\$\{VAETTIR_NATIVE_JOBS:-2\}/);assert.match(shell,/case "\$native_jobs" in 2\|4/);assert.match(shell,/8388608/);assert.match(shell,/8589934592/);assert.match(shell,/DEB_BUILD_OPTIONS="parallel=\$native_jobs"/);assert.match(shell,/test "\$\(id -u\)" != 0/);assert.match(shell,/make -C "\$build_dir" -j"\$native_jobs" check >/);assert.match(shell,/make -C "\$build_dir" -j"\$native_jobs" check-abi/);assert.match(shell,/patch --batch --fuzz=0 -p1 --dry-run/);assert.doesNotMatch(shell,/--force|--allow-unauthenticated|DEB_BUILD_OPTIONS=.*nocheck|make.*check.*\|\| true|stop-on-test-failure/);
});
test('installed counterpart checks scope existing API FreeType separately from Web glibc without creating a new Web package',()=>{
  const checker=readFileSync(new URL('./check-installed-runtime-family.mjs',import.meta.url),'utf8');
  assert.match(checker,/assert\.ok\(\['api','web'\]\.includes\(kind\)\)/);
  assert.match(checker,/components=kind==='api'\?\['glibc','freetype'\]:\['glibc'\]/);
  assert.equal(checker.match(/for\(const component of components\)/g).length,2);
  assert.match(checker,/Mixed maintained\/runtime family/);
  assert.match(checker,/Installed family bytes differ from admitted ABI artifact/);
  assert.doesNotMatch(checker,/apt-get|dpkg --install|download|fetch\(/);
});
test('actual standard Meson result requires the complete single maintained test with known success, not a fabricated CID proof',()=>{
 const valid={name:'issue-1063',result:'OK',returncode:0};
 assert.equal(requireFreeTypeStandardResult(JSON.stringify(valid)+'\n').cidTargetedAcceptance,false);
 for(const change of [{name:'other'},{result:'FAIL'},{result:'SKIP'},{returncode:1}])assert.throws(()=>requireFreeTypeStandardResult(JSON.stringify({...valid,...change})));
 assert.throws(()=>requireFreeTypeStandardResult(''));assert.throws(()=>requireFreeTypeStandardResult(JSON.stringify(valid)+'\n'+JSON.stringify(valid)));
 const shell=readFileSync(new URL('./build-maintained-runtime.sh',import.meta.url),'utf8');
 assert.match(shell,/--wrap-mode=nodownload/);assert.match(shell,/meson test.*--no-rebuild/);assert.match(shell,/freetype-standard-test-proof\.json/);
});
