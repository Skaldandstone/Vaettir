import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requireSourceManifest,requireSignature,requireTestSummary,parseDynSymbols,requireAbiPreservation,requireFreeTypeStandardResult} from './runtime-build-proof.mjs';
const manifest=readFileSync(new URL('./runtime-security-sources.json',import.meta.url));
test('exact reviewed maintained source manifest admits 10 sources/23 ordered official patches and refuses changed custody',()=>{
  const value=requireSourceManifest(manifest);assert.equal(value.components.glibc.patches.length,22);assert.equal(value.components.freetype.patches.length,1);assert.throws(()=>requireSourceManifest(Buffer.concat([manifest,Buffer.from(' ')])));
});
test('exact original signer/primary only, no expired/revoked or additional signatures',()=>{
  const component=requireSourceManifest(manifest).components.glibc;
  const line=`[GNUPG:] VALIDSIG ${component.signer} 2026-10-12 1 0 4 0 1 10 00 ${component.primarySigner}\n`;
  requireSignature(line,component);for(const bad of ['EXPKEYSIG','EXPSIG','KEYEXPIRED','REVKEYSIG','BADSIG','ERRSIG','NO_PUBKEY'])assert.throws(()=>requireSignature(line+`[GNUPG:] ${bad} key\n`,component));assert.throws(()=>requireSignature(line+line,component));assert.throws(()=>requireSignature(line.replace(component.primarySigner,'A'.repeat(40)),component));
});
const names=['resolv/tst-ns_sprintrr','posix/tst-wordexp-tilde','posix/tst-wordexp-append','stdlib/tst-strfmon-bug34510','iconvdata/tst-jisx0213-progress','libio/tst-fopen-ccs-empty','elf/tst-dl-path-normalize','elf/tst-origin-secure','string/test-strncasecmp-nonarray'];
const summary='\t\t=== glibc tests ===\n'+['.','elf','nptl','stdlib','string','math','iconvdata','posix','resolv','libio','conform'].map(name=>'Running '+name+' ...\n').join('')+names.map(name=>'PASS: '+name+'\n').join('');
test('full-suite model admits official regressions, preserves XFAIL/UNSUPPORTED, refuses FAIL/XPASS/ERROR/UNRESOLVED/missing directories',()=>{
  const proof=requireTestSummary(summary+'XFAIL: nptl/expected\nUNSUPPORTED: elf/privileged\n');assert.equal(proof.counts.XFAIL,1);assert.equal(proof.counts.UNSUPPORTED,1);
  for(const status of ['FAIL','XPASS','ERROR','UNRESOLVED','UNKNOWN'])assert.throws(()=>requireTestSummary(summary+status+': elf/failure\n'));assert.throws(()=>requireTestSummary(summary.replace('Running nptl ...\n','')));assert.throws(()=>requireTestSummary(summary.replace('PASS: '+names[0],'UNSUPPORTED: '+names[0])));assert.throws(()=>requireTestSummary(summary+'PASS: '+names[0]+'\n'));
});
const symbols='Symbol table .dynsym:\n 1: 00000010 8 OBJECT GLOBAL DEFAULT 12 exported@@GLIBC_2.2.5\n 2: 00000000 4 TLS GLOBAL DEFAULT 14 tls@GLIBC_2.34\n 3: 00000030 42 FUNC WEAK DEFAULT 12 function@@GLIBC_2.41\n 4: 00000000 0 FUNC GLOBAL DEFAULT UND dependency@GLIBC_2.2.5 (1)\n';
test('exact versioned exports include default/nondefault ABI and OBJECT/TLS sizes, not code addresses or FUNC sizes',()=>{
  const old=parseDynSymbols(symbols);assert.equal(old.length,3);requireAbiPreservation(old,old.map(row=>({...row,address:'abcd',size:row.type==='FUNC'?84:row.size})));
  for(const index of [0,1])assert.throws(()=>requireAbiPreservation(old,old.map((row,i)=>({...row,size:i===index?row.size+1:row.size}))));assert.throws(()=>requireAbiPreservation(old,old.slice(1)));assert.throws(()=>requireAbiPreservation(old,old.map(row=>({...row,name:row.name.replace('@@','@')}))));assert.throws(()=>requireAbiPreservation(old,old.map(row=>({...row,type:'FUNC'}))));
});
test('candidate retains aggregate budget, unprivileged native full check, maintained quilt and no weakened tests/options',()=>{
  const shell=readFileSync(new URL('./build-maintained-runtime.sh',import.meta.url),'utf8');assert.match(shell,/deadline=\$\(\(started \+ 3500\)\)/);assert.match(shell,/DEB_BUILD_OPTIONS=parallel=2/);assert.match(shell,/test "\$\(id -u\)" != 0/);assert.match(shell,/make -C "\$build_dir" -j2 check >/);assert.match(shell,/make -C "\$build_dir" -j2 check-abi/);assert.match(shell,/patch --batch --fuzz=0 -p1 --dry-run/);assert.doesNotMatch(shell,/--force|--allow-unauthenticated|DEB_BUILD_OPTIONS=.*nocheck|make.*check.*\|\| true|stop-on-test-failure/);
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
