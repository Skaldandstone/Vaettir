// Maintained native package proof. Importing validators never starts a build.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,lstatSync,realpathSync,readdirSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {corpus,requireCorpusBytes} from './fetch-freetype-test-corpus.mjs';

export const MANIFEST_SHA256='f1cc5c7ca0c1a2778a7933b4384bc626a8623e8ec32db567c6891b52db0ee5ec';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function requireSourceManifest(bytes){
  assert.equal(sha(bytes),MANIFEST_SHA256,'Reviewed security manifest changed');
  const manifest=JSON.parse(bytes);
  assert.equal(manifest.version,'runtime-security-sources/v1');
  assert.deepEqual(Object.keys(manifest.components).sort(),['freetype','glibc']);
  assert.equal(manifest.components.glibc.sourceVersion,'2.41-12+deb13u4');
  assert.equal(manifest.components.freetype.sourceVersion,'2.13.3+dfsg-1+deb13u1');
  assert.equal(manifest.components.glibc.sourceFiles.length,3);assert.equal(manifest.components.freetype.sourceFiles.length,7);
  assert.equal(manifest.components.glibc.patches.length,22);assert.equal(manifest.components.freetype.patches.length,1);
  return manifest;
}
export function requireSignature(status,component){
  assert.ok(status.length<65536);
  assert.doesNotMatch(status,/\[GNUPG:\] (?:EXPKEYSIG|EXPSIG|KEYEXPIRED|SIGEXPIRED|REVKEYSIG|BADSIG|ERRSIG|NO_PUBKEY)\b/);
  const valid=status.split(/\r?\n/).filter(line=>line.startsWith('[GNUPG:] VALIDSIG '));assert.equal(valid.length,1);
  const fields=valid[0].split(/\s+/);assert.equal(fields[2],component.signer);assert.equal(fields.at(-1),component.primarySigner);
  return {signer:component.signer,primarySigner:component.primarySigner,statusSha256:sha(status)};
}
export function requireTestSummary(text){
  assert.ok(text.length>0&&text.length<=8*1024*1024);
  assert.match(text,/=== glibc tests ===/);assert.doesNotMatch(text,/^(?:FAIL|XPASS|UNRESOLVED|ERROR):/m);
  const running=[...text.matchAll(/^Running (\S+) \.\.\.$/gm)].map(match=>match[1]);
  for(const part of ['.','elf','nptl','stdlib','string','math','iconvdata','posix','resolv','libio','conform'])assert.ok(running.includes(part),'Full native suite missing '+part);
  const records=[];
  for(const line of text.split(/\r?\n/)){
    const match=/^(PASS|XFAIL|UNSUPPORTED): ([A-Za-z0-9_./+-]+)$/.exec(line);
    if(match){assert.ok(!match[2].split('/').includes('..'));records.push({status:match[1],name:match[2]});}
    else assert.ok(!/^[A-Z]+:/.test(line),'Unrecognized test status: '+line);
  }
  assert.ok(records.length>0);assert.equal(new Set(records.map(row=>row.name)).size,records.length,'Duplicate native test identity');
  for(const name of ['resolv/tst-ns_sprintrr','posix/tst-wordexp-tilde','posix/tst-wordexp-append','stdlib/tst-strfmon-bug34510','iconvdata/tst-jisx0213-progress','libio/tst-fopen-ccs-empty','elf/tst-dl-path-normalize','elf/tst-origin-secure','string/test-strncasecmp-nonarray'])assert.equal(records.find(row=>row.name===name)?.status,'PASS','Official maintained patch regression missing/not PASS: '+name);
  return {summarySha256:sha(text),records,counts:Object.fromEntries(['PASS','XFAIL','UNSUPPORTED'].map(status=>[status,records.filter(row=>row.status===status).length])),FAIL:0,XPASS:0};
}
// Diagnostics only. Preserve exact failed bytes before Node's assertion display
// truncates them; this never changes a test status or admits a failed summary.
export function nativeFailureEvidence(summary,readOptional=()=>undefined){
  assert.ok(Buffer.isBuffer(summary)&&summary.length>0&&summary.length<=8*1024**2);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(summary),issues=text.split(/\r?\n/).filter(line=>/^[A-Z]+:/.test(line)&&!/^(PASS|XFAIL|UNSUPPORTED):/.test(line));
  assert.ok(issues.length<=1000);const files=[],withheld=[];let total=summary.length<=512*1024?summary.length:0;
  const original={path:'tests.sum',bytes:summary.length,sha256:sha(summary),...(total?{base64:summary.toString('base64')}:{withheld:'Summary exceeds bounded diagnostic payload'})};
  const names=[...new Set(issues.flatMap(line=>{const m=/^[A-Z]+: ([A-Za-z0-9_./+-]+)$/.exec(line);return m&&!m[1].split('/').some(part=>part==='.'||part==='..'||part==='')?[m[1]]:[];}))];
  for(const name of names)for(const extension of ['test-result','out']){
    const path=name+'.'+extension;try{const bytes=readOptional(path);if(bytes===undefined){withheld.push({path,reason:'Unavailable or exceeds per-file bound'});continue;}
      assert.ok(Buffer.isBuffer(bytes)&&bytes.length<=128*1024);if(total+bytes.length>1024**2){withheld.push({path,reason:'Aggregate diagnostic payload bound'});continue;}
      total+=bytes.length;files.push({path,bytes:bytes.length,sha256:sha(bytes),base64:bytes.toString('base64')});
    }catch{withheld.push({path,reason:'Exact regular diagnostic file could not be read'});}
  }
  return {purpose:'original-native-test-failure-evidence/v1',summary:original,issues,files,withheld,payloadBytes:total,nativeTestsAccepted:false};
}
export function parseDynSymbols(text){
  assert.ok(text.length<=32*1024*1024);const symbols=[];
  for(const line of text.split(/\r?\n/)){
    const m=/^\s*\d+:\s+([0-9a-f]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+\(\d+\))?\s*$/.exec(line);if(!m)continue;
    const [,address,size,type,bind,visibility,index,name]=m;
    if(index==='UND'||!['GLOBAL','WEAK','GNU_UNIQUE','UNIQUE'].includes(bind)||!['DEFAULT','PROTECTED'].includes(visibility))continue;
    assert.ok(['FUNC','IFUNC','OBJECT','TLS','NOTYPE'].includes(type),'Unrecognized exported symbol type');
    // A single @ and @@ are distinct ABI entries; never erase symbol versions.
    symbols.push({name,type,bind,visibility,size:Number(size),address});
  }
  assert.ok(symbols.length>0);return symbols;
}
export function requireAbiPreservation(baseline,candidate){
  const key=symbol=>JSON.stringify([symbol.name,symbol.type,symbol.bind,symbol.visibility]);
  const next=new Map(candidate.map(symbol=>[key(symbol),symbol]));assert.equal(next.size,candidate.length,'Duplicate candidate exported ABI');
  for(const old of baseline){const present=next.get(key(old));assert.ok(present,'Missing/changed versioned exported ABI '+old.name);if(old.type==='OBJECT'||old.type==='TLS')assert.equal(present.size,old.size,'Changed exported '+old.type+' size '+old.name);}
  return {baselineExports:baseline.length,candidateExports:candidate.length,objectAndTlsSizesPreserved:true,baselineSha256:sha(JSON.stringify(baseline)),candidateSha256:sha(JSON.stringify(candidate))};
}
export function requireFreeTypeStandardResult(text){
  assert.ok(text.length>0&&text.length<=1048576);
  const records=text.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.equal(records.length,1,'Expected the complete maintained FreeType standard test suite');
  assert.equal(records[0].name,'issue-1063');assert.equal(records[0].result,'OK');assert.equal(records[0].returncode,0);
  return {standardTest:'issue-1063',standardTestPassed:true,testLogSha256:sha(text),cidTargetedAcceptance:false};
}
function command(file,args){return execFileSync(file,args,{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});}
function regular(path){const stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink());return stat;}
function sourcePins(manifest,component,sourceDir){
  assert.ok(['glibc','freetype'].includes(component));
  const item=manifest.components[component];
  for(const file of [...item.sourceFiles,...item.patches]){assert.match(file.name,/^[A-Za-z0-9_.+-]+$/);const path=join(sourceDir,file.name);const stat=regular(path),bytes=readFileSync(path);assert.equal(stat.size,file.bytes);assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);}
  return item;
}
function prepare(manifest,component,sourceDir,tree,proofRoot){
  const item=sourcePins(manifest,component,sourceDir);
  requireSignature(readFileSync(join(proofRoot,component+'-source-signature.status'),'utf8'),item);
  assert.equal(command('dpkg-parsechangelog',['-l'+join(tree,'debian/changelog'),'-S','Version']).trim(),item.sourceVersion);
  const series=readFileSync(join(tree,'debian/patches/series'),'utf8');assert.ok(series.endsWith('\n'));assert.ok(!series.includes('vaettir-official-'));
  // Maintain ordered official fixes as quilt patches; apply one at a time with
  // exact context so subsequent dependent patches see their actual predecessor.
  for(const patch of item.patches){
    const name='vaettir-official-'+patch.name;
    writeFileSync(join(tree,'debian/patches',name),readFileSync(join(sourceDir,patch.name)),{flag:'wx'});
  }
  writeFileSync(join(tree,'debian/patches/series'),series+item.patches.map(p=>'vaettir-official-'+p.name+' -p1\n').join(''));
  const file=join(tree,'debian/changelog'),old=readFileSync(file,'utf8');
  writeFileSync(file,`${component} (${item.sourceVersion}+vaettir1) trixie; urgency=medium\n\n  * Local compatible rebuild from maintained signed Debian source and the\n    exact reviewed ordered official fixes. Retain package rules/ABI and\n    full native functional test evidence; do not claim provider or deployment\n    acceptance. FreeType CID-targeted acceptance remains separately required.\n\n -- Vaettir Runtime Build <runtime-build@skaldandstone.com>  Mon, 12 Oct 2026 00:00:00 +0000\n\n${old}`);
  writeFileSync(join(proofRoot,component+'-source-proof.json'),JSON.stringify({component,manifestSha256:MANIFEST_SHA256,sourceVersion:item.sourceVersion,localVersion:item.sourceVersion+'+vaettir1',signer:item.signer,primarySigner:item.primarySigner,maintainedSeriesSha256:sha(series),orderedOfficialPatches:item.patches.map(p=>({commit:p.commit,sha256:p.sha256})),nativeTestsPassed:false},null,2)+'\n',{flag:'wx'});
}
function testProof(buildDir,output){
  const summaryBytes=readFileSync(join(buildDir,'tests.sum')),summary=summaryBytes.toString('utf8');let result;
  try{result=requireTestSummary(summary);}catch(original){
    try{const evidence=nativeFailureEvidence(summaryBytes,path=>{const file=resolve(buildDir,path);assert.ok(file.startsWith(resolve(buildDir)+'/'));const stat=regular(file);if(stat.size>128*1024)return undefined;return readFileSync(file);});console.error('NATIVE_TEST_FAILURE_EVIDENCE='+JSON.stringify(evidence));}catch{console.error('Native failure evidence capture could not complete; original summary validation still fails.');}
    throw original;
  }
  for(const row of result.records){const file=resolve(buildDir,row.name+'.test-result');assert.ok(file.startsWith(resolve(buildDir)+'/'));const first=readFileSync(file,'utf8').split(/\r?\n/)[0];assert.equal(first,row.status+': '+row.name,'Summary does not match individual native result');}
  writeFileSync(output,JSON.stringify({...result,standardNativeCheck:true,nativeAbiCheckRequired:true},null,2)+'\n',{flag:'wx'});
}
function abiProof(base,candidate,output){
  regular(base);regular(candidate);
  const oldSoname=command('readelf',['-dW',base]).match(/\(SONAME\).*\[([^\]]+)\]/)?.[1],newSoname=command('readelf',['-dW',candidate]).match(/\(SONAME\).*\[([^\]]+)\]/)?.[1];
  assert.equal(newSoname,oldSoname,'SONAME changed');
  const before=parseDynSymbols(command('readelf',['--dyn-syms','--wide',base])),after=parseDynSymbols(command('readelf',['--dyn-syms','--wide',candidate]));
  const abi=requireAbiPreservation(before,after);
  writeFileSync(output,JSON.stringify({base,candidate,soname:oldSoname??null,baseSha256:sha(readFileSync(base)),candidateSha256:sha(readFileSync(candidate)),...abi},null,2)+'\n',{flag:'wx'});
}
function elfFamily(component,runtimeRoot,output){
  assert.ok(['glibc','freetype'].includes(component));
  const pkg=component==='glibc'?'libc6':'libfreetype6';
  const listed=command('dpkg-query',['-L',pkg]).trim().split('\n');
  const seen=new Set(),rows=[];
  for(const path of listed){
    if(!/\.so(?:\.|$)|\/ld-linux-/.test(path))continue;
    const base=realpathSync(path);if(seen.has(base)||!lstatSync(base).isFile())continue;
    const bytes=readFileSync(base);if(!bytes.subarray(0,4).equals(Buffer.from([127,69,76,70])))continue;
    seen.add(base);assert.ok(seen.size<=512);
    const candidate=join(runtimeRoot,base),resolved=realpathSync(candidate);
    assert.ok(resolved.startsWith(resolve(runtimeRoot)+'/'),'Staged runtime symlink escaped isolated package root');regular(resolved);
    const name=relative('/usr/lib',base).replaceAll('/','_');assert.match(name,/^[A-Za-z0-9_.+-]+$/);
    const proofFile=join(dirname(output),component+'-abi-'+name+'.json');abiProof(base,resolved,proofFile);
    rows.push({path:base,sha256:sha(readFileSync(resolved)),bytes:lstatSync(resolved).size,abiProofSha256:sha(readFileSync(proofFile))});
  }
  assert.ok(rows.length>0);if(component==='glibc'){assert.ok(rows.some(row=>row.path.endsWith('/libc.so.6')));assert.ok(rows.some(row=>row.path.endsWith('/ld-linux-x86-64.so.2')));}
  writeFileSync(output,JSON.stringify({version:'runtime-installed-elf/v1',component,rows,installedBytesVerified:false},null,2)+'\n',{flag:'wx'});
}
function packageProof(component,root){
  const packages=readdirSync(root).filter(name=>name.endsWith('.deb'));assert.ok(packages.length>0&&packages.length<=32);
  const version=component==='glibc'?'2.41-12+deb13u4+vaettir1':'2.13.3+dfsg-1+deb13u1+vaettir1';const rows=[];
  for(const name of packages){const path=join(root,name);regular(path);const pkg=command('dpkg-deb',['-f',path,'Package']).trim(),v=command('dpkg-deb',['-f',path,'Version']).trim(),arch=command('dpkg-deb',['-f',path,'Architecture']).trim();assert.equal(v,version);assert.ok(['amd64','all'].includes(arch));rows.push({name,package:pkg,version:v,architecture:arch,bytes:lstatSync(path).size,sha256:sha(readFileSync(path))});}
  for(const pkg of component==='glibc'?['libc6','libc-bin','libc6-dev','libc-dev-bin','libc-l10n','locales']:['libfreetype6','libfreetype-dev','freetype2-demos'])assert.ok(rows.some(row=>row.package===pkg),'Missing rebuilt family member '+pkg);
  writeFileSync(join(root,component+'-package-inventory.json'),JSON.stringify({component,version,rows,installedFamilyAcceptance:false,targetedCidAcceptance:component==='freetype'?false:null},null,2)+'\n',{flag:'wx'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [mode,...args]=process.argv.slice(2);
  const paths=mode==='pins'?args.filter((_value,i)=>i!==1):['prepare','packages','elf-family','signature'].includes(mode)?args.slice(1):args;
  for(const path of paths)assert.ok(path.startsWith('/'),'Build evidence paths must be absolute');
  if(mode==='pins'){assert.equal(args.length,3);sourcePins(requireSourceManifest(readFileSync(args[0])),args[1],args[2]);}
  else if(mode==='signature'){assert.equal(args.length,3);assert.ok(['glibc','freetype'].includes(args[0]));requireSignature(readFileSync(args[2],'utf8'),requireSourceManifest(readFileSync(args[1])).components[args[0]]);}
  else if(mode==='prepare'){assert.equal(args.length,5);prepare(requireSourceManifest(readFileSync(args[1])),args[0],args[2],args[3],args[4]);}
  else if(mode==='tests'){assert.equal(args.length,2);testProof(...args);}
  else if(mode==='abi'){assert.equal(args.length,3);abiProof(...args);}
  else if(mode==='packages'){assert.equal(args.length,2);packageProof(...args);}
  else if(mode==='elf-family'){assert.equal(args.length,3);elfFamily(...args);}
  else if(mode==='standard-corpus'){
    assert.equal(args.length,2);
    for(const[name,kind]of [['original-corpus.zip','archive'],[corpus.fontName,'font']]){regular(join(args[0],name));requireCorpusBytes(readFileSync(join(args[0],name)),kind);}
    writeFileSync(args[1],JSON.stringify({...corpus,originalSignedUpstreamPrefixMatched:true,fullHashesMatched:true,nativeExecuted:false},null,2)+'\n',{flag:'wx'});
  }
  else if(mode==='freetype-standard-test'){
    assert.equal(args.length,2);regular(args[0]);writeFileSync(args[1],JSON.stringify(requireFreeTypeStandardResult(readFileSync(args[0],'utf8')),null,2)+'\n',{flag:'wx'});
  }
  else throw Error('Unknown reviewed proof operation');
}
