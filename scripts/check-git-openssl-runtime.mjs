import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFile,execFileSync} from "node:child_process";
import {promisify} from "node:util";
import {createServer} from "node:https";
import {readFileSync,readdirSync,lstatSync,readlinkSync,realpathSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {resolve,join,dirname,basename,relative,sep} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
export const PACKAGE_VERSION="1:2.47.3-0+deb13u1+vaettir1";
export const CURL_PUBLIC_CERTIFICATE=Object.freeze({url:'https://keyring.debian.org/pks/lookup?op=get&search=0x05DB6A837E105F4B1D02C55FBBA9FAADCCFB4707',rawBytes:64986,rawSha256:'4451f938a540a2da428b68598422c49a4bc176ed1c9d91dd5ecd346303608618',keyringBytes:47569,keyringSha256:'96d7267ff6f1c1285a804d682afb1c3eb5efea85c920b4f93c2a0d2052983723',primaryFingerprint:'BFAE9E331A867A7C80D8EB78F4E4ACDBB8D08BE0',signerFingerprint:'05DB6A837E105F4B1D02C55FBBA9FAADCCFB4707',primaryExpiry:1868115570,signerExpiry:1868115646});
export function dearmorPublicCertificate(bytes){
  assert.ok(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=65536);assert.ok(bytes.every(x=>x===10||(x>=32&&x<=126)),'Noncanonical ASCII armor');
  const lines=bytes.toString('ascii').replace(/\n$/,'').split('\n');assert.equal(lines.shift(),'-----BEGIN PGP PUBLIC KEY BLOCK-----');assert.equal(lines.pop(),'-----END PGP PUBLIC KEY BLOCK-----');
  if(lines[0]==='Comment: Key ID: 0xBBA9FAADCCFB4707')lines.shift();assert.equal(lines.shift(),'','Unknown public armor header');
  const checksum=lines.pop();assert.match(checksum,/^=[A-Za-z0-9+/]{4}$/);assert.ok(lines.length>0);assert.ok(lines.every((line,index)=>index===lines.length-1?/^[A-Za-z0-9+/]{2,64}={0,2}$/.test(line):/^[A-Za-z0-9+/]{64}$/.test(line)));
  const encoded=lines.join(''),binary=Buffer.from(encoded,'base64');assert.equal(binary.toString('base64'),encoded,'Noncanonical base64');let crc=0xb704ce;
  for(const byte of binary){crc^=byte<<16;for(let bit=0;bit<8;bit++){crc<<=1;if(crc&0x1000000)crc^=0x1864cfb;}}crc&=0xffffff;const expected=Buffer.from([crc>>16,(crc>>8)&255,crc&255]).toString('base64');assert.equal(checksum,'='+expected,'Public armor CRC24 mismatch');return binary;
}
export function decodePinnedCurlCertificate(raw){
  assert.ok(Buffer.isBuffer(raw));assert.equal(raw.length,CURL_PUBLIC_CERTIFICATE.rawBytes);assert.equal(createHash('sha256').update(raw).digest('hex'),CURL_PUBLIC_CERTIFICATE.rawSha256);
  const prefix='<!DOCTYPE html\n\tPUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"\n\t "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n<html xmlns="http://www.w3.org/1999/xhtml" lang="en-US" xml:lang="en-US">\n<head>\n<title>Public Key Server -- Get ``0xBBA9FAADCCFB4707&#39;&#39;</title>\n<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" />\n</head>\n<body>\n<h1>Public Key Server -- Get ``0xBBA9FAADCCFB4707\'\'</h1><pre>\n',suffix='\n</pre>\n</body>\n</html>';
  const text=raw.toString('ascii');assert.ok(text.startsWith(prefix)&&text.endsWith(suffix),'Unreviewed certificate response wrapper');const ring=dearmorPublicCertificate(Buffer.from(text.slice(prefix.length,-suffix.length),'ascii'));assert.equal(ring.length,CURL_PUBLIC_CERTIFICATE.keyringBytes);assert.equal(createHash('sha256').update(ring).digest('hex'),CURL_PUBLIC_CERTIFICATE.keyringSha256);return ring;
}
export async function fetchPinnedCurlCertificate({fetchImpl=fetch}={}){
  let response;try{response=await fetchImpl(CURL_PUBLIC_CERTIFICATE.url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('Pinned public certificate transport failed');}assert.equal(response.status,200);assert.ok(response.body);const chunks=[];let size=0;
  try{for await(const bytes of response.body){size+=bytes.length;assert.ok(size<=65536,'Public certificate bound exceeded');chunks.push(bytes);}}catch{throw Error('Pinned public certificate body rejected');}const raw=Buffer.concat(chunks),keyring=decodePinnedCurlCertificate(raw),proof={schema:'vaettir-same-principal-public-certificate/v1',...CURL_PUBLIC_CERTIFICATE,newTrustedPrincipal:false,trustPolicyChanged:false};assertCurlCertificateArtifacts(raw,keyring,proof);return{raw,keyring,proof};
}
export function assertCurlCertificateArtifacts(raw,ring,proof,nowSeconds=Date.now()/1000){assert.ok(decodePinnedCurlCertificate(raw).equals(ring));assert.deepEqual(proof,{schema:'vaettir-same-principal-public-certificate/v1',...CURL_PUBLIC_CERTIFICATE,newTrustedPrincipal:false,trustPolicyChanged:false});assert.ok(Number.isFinite(nowSeconds)&&nowSeconds<CURL_PUBLIC_CERTIFICATE.primaryExpiry&&nowSeconds<CURL_PUBLIC_CERTIFICATE.signerExpiry,'Existing principal certificate expired');return proof;}
export const SELECTED_GIT_SUITES=Object.freeze(['t0001-init.sh','t1000-read-tree-m-3way.sh','t5601-clone.sh']);
export function assertSelectedGitUpstream(rows){assert.deepEqual(rows.map(row=>row.name),SELECTED_GIT_SUITES);assert.ok(rows.every(row=>row.exitCode===0&&Number.isInteger(row.passed)&&row.passed>0&&Number.isInteger(row.skipped)&&row.skipped>=0&&/^[a-f0-9]{64}$/.test(row.logSha256)));}
export const PUBLIC_BUILD_STAGES=Object.freeze(['SOURCE_SIGNATURES','SOURCE_EXTRACT','CURL_AUTORECONF','CURL_CONFIGURE','CURL_BUILD','CURL_UPSTREAM','CURL_INSTALL','CURL_METADATA','GIT_BUILD','GIT_UPSTREAM','GIT_INSTALL','PACKAGE_METADATA','PACKAGE_RUNTIME','PACKAGE_BUILD']);
export const PUBLIC_BUILD_LOGS=Object.freeze(['curl-autoreconf.log','curl-configure.log','curl-build.log','curl-upstream.log','curl-install.log','git-build.log','t0001-init.sh.log','t1000-read-tree-m-3way.sh.log','t5601-clone.sh.log','git-install.log','git-runtime-stderr.log']);
export function publicBuildFailureDiagnostics(stage,exitCode,logs){
  assert.ok(PUBLIC_BUILD_STAGES.includes(stage));assert.ok(Number.isInteger(exitCode)&&exitCode>0&&exitCode<=255);assert.ok(logs.length<=PUBLIC_BUILD_LOGS.length);
  let budget=65536;const excerpts=[];
  for(const row of logs){assert.ok(PUBLIC_BUILD_LOGS.includes(row.name));assert.ok(Buffer.isBuffer(row.bytes)&&row.bytes.length<=16384);const text=row.bytes.toString('utf8').split(/\r?\n/).slice(-80).map(line=>/authorization|bearer|password|secret|access[_ -]?key|token|set-cookie/i.test(line)?'[REDACTED SENSITIVE-LOOKING LINE]':line.replace(/https?:\/\/[^\s"'<>]+/gi,'[PUBLIC-OR-SYNTHETIC-URL]')).join('\n');const bounded=Buffer.from(text).subarray(0,Math.min(8192,budget)).toString();budget-=Buffer.byteLength(bounded);excerpts.push({name:row.name,excerpt:bounded});if(budget<=0)break;}
  return {schema:'vaettir-public-source-build-failure/v1',stage,originalExitCode:exitCode,excerpts,scope:'Bounded public-source or selected synthetic-test logs only',failureRetained:true,nativeAcceptance:false,securityAcceptance:false};
}
const sha=data=>createHash("sha256").update(data).digest("hex");
const execute=promisify(execFile);
const expectedSources=JSON.parse(readFileSync(new URL("./git-openssl-sources.json",import.meta.url),"utf8"));
export function assertSourceIdentity(sources){assert.deepEqual(sources,expectedSources);return sources;}
export function assertSignature(status,signer){
  assert.match(signer,/^[A-F0-9]{40}$/);
  assert.doesNotMatch(status,/\[GNUPG:\] (?:BADSIG|ERRSIG|EXPSIG|EXPKEYSIG|REVKEYSIG|KEYEXPIRED|SIGEXPIRED)\b/);
  const lines=status.split(/\r?\n/).filter(line=>line.startsWith("[GNUPG:] VALIDSIG "));
  assert.equal(lines.length,1);assert.equal(lines[0].split(" ")[2],signer);
}
export function assertCurlConfiguration(config){
  assert.equal(config.version.trim(),"libcurl 8.22.0");
  assert.equal(config.sslBackends.trim(),"OpenSSL");
  const protocols=config.protocols.trim().split(/\s+/).sort();assert.deepEqual(protocols,["HTTP","HTTPS"]);
  const features=config.features.trim().split(/\s+/);assert.ok(features.includes("SSL")&&features.includes("HTTP2"));
  assert.ok(!features.some(feature=>/GSS|Kerberos|SPNEGO|NTLM|HTTP3|TLS-SRP/i.test(feature)));
  assert.doesNotMatch(config.staticLibs,/gnutls|krb5|gssapi|ldap|lber|sasl|rtmp|ngtcp2|nghttp3/i);
  assert.match(config.staticLibs,/libcurl\.a|-lcurl/);
  return{version:"8.22.0",tlsBackend:"OpenSSL",protocols,features,libraryStrategy:"static curl in Git HTTP helpers; system OpenSSL and nghttp2 remain dynamic"};
}
const allowedNeeded=new Set(["libssl.so.3","libcrypto.so.3","libnghttp2.so.14","libz.so.1","libexpat.so.1","libpcre2-8.so.0","libc.so.6","libm.so.6","libdl.so.2","libpthread.so.0","libresolv.so.2","ld-linux-x86-64.so.2","libgcc_s.so.1"]);
export function assertPackageELF(rows){
  assert.ok(rows.length>0&&rows.length<=500);
  for(const row of rows){assert.ok(row.path.startsWith("usr/"));for(const needed of row.needed)assert.ok(allowedNeeded.has(needed),"Unexpected package ELF dependency");}
  assert.ok(rows.some(row=>row.path==="usr/lib/git-core/git-remote-http"));
  assert.ok(rows.some(row=>row.needed.includes("libssl.so.3")&&row.needed.includes("libcrypto.so.3")));
}
const forbiddenPackage=/^(?:libcurl(?:3t64-gnutls|4-gnutls)|libgnutls|libgssapi-krb5|libkrb5|libk5crypto|libldap|libsasl2|librtmp|libngtcp2-crypto-gnutls)/;
export function assertAbsentFamilies(status){
  for(const paragraph of status.split(/\r?\n\r?\n/)){
    const name=/^Package: (.+)$/m.exec(paragraph)?.[1];
    if(name&&forbiddenPackage.test(name))assert.doesNotMatch(paragraph,/^Status: .* (?:installed|config-files|unpacked|half-installed|half-configured|triggers-awaited|triggers-pending)$/m,"Old runtime family remains in dpkg state");
  }
}
function command(file,args,options={}){return execFileSync(file,args,{encoding:"utf8",timeout:10000,maxBuffer:65536,windowsHide:true,...options});}
function packageFiles(root){
  const files=[];let count=0,bytes=0;const hashed=new Map();
  function visit(directory){for(const name of readdirSync(directory)){const path=join(directory,name),rel=relative(root,path).split(sep).join("/");assert.ok(++count<=3000);
    const stat=lstatSync(path);if(stat.isDirectory()){visit(path);continue;}
    assert.ok(rel.startsWith("usr/"),"Package path outside usr");
    if(stat.isSymbolicLink()){const target=readlinkSync(path),actual=realpathSync(path);assert.ok(actual===root||actual.startsWith(root+sep));files.push({path:rel,type:"symlink",target});continue;}
    assert.ok(stat.isFile()&&stat.size<=32*1024*1024);const key=String(stat.dev)+":"+String(stat.ino);let proof=hashed.get(key);
    if(!proof){bytes+=stat.size;assert.ok(bytes<=256*1024*1024);const data=readFileSync(path);proof={sha256:sha(data),size:data.length,elf:data.subarray(0,4).equals(Buffer.from([127,69,76,70]))};hashed.set(key,proof);}
    const row={path:rel,type:"file",mode:stat.mode&0o777,...proof};if(row.elf){const dynamic=command("readelf",["-d",path]);row.needed=[...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)].map(match=>match[1]);}files.push(row);
  }}
  visit(join(root,"usr"));return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function environment(root,gitExec){return{PATH:"/usr/bin:/bin",HOME:root,LANG:"C",LC_ALL:"C",GIT_EXEC_PATH:gitExec,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_TERMINAL_PROMPT:"0",GIT_ASKPASS:"/bin/false",GIT_AUTHOR_DATE:"2000-01-01T00:00:00Z",GIT_COMMITTER_DATE:"2000-01-01T00:00:00Z"};}
// Disposable loopback-only TLS + actual Git clone/ls-remote. No production URL.
export async function checkGitTLS(git,gitExec){
  const root=mkdtempSync(join(tmpdir(),"vaettir-git-openssl-")),env=environment(root,gitExec);let success=false,server;
  const run=(file,args)=>command(file,args,{env});
  const gitRun=args=>run(git,args);
  const gitAsync=async args=>(await execute(git,args,{env,encoding:"utf8",timeout:10000,maxBuffer:65536,windowsHide:true})).stdout;
  async function close(){if(!server)return;server.closeAllConnections();await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error("Loopback server close timeout")),2000);server.close(()=>{clearTimeout(timer);yes();});});server=undefined;}
  try{
    run("openssl",["req","-x509","-newkey","rsa:2048","-sha256","-days","1","-nodes","-subj","/CN=Vaettir synthetic root","-addext","basicConstraints=critical,CA:TRUE","-addext","keyUsage=critical,keyCertSign,cRLSign","-keyout",join(root,"ca.key"),"-out",join(root,"ca.pem")]);
    run("openssl",["req","-newkey","rsa:2048","-sha256","-nodes","-subj","/CN=Vaettir synthetic server","-keyout",join(root,"leaf.key"),"-out",join(root,"leaf.csr")]);
    for(const [name,san,extra] of [["trusted","IP:127.0.0.1",""],["wrong-host","DNS:wrong.example.invalid",""],["invalid-extension","IP:127.0.0.1","1.2.3.4=critical,DER:05:00\n"]]){
      writeFileSync(join(root,name+".ext"),"basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName="+san+"\n"+extra,{flag:"wx"});
      run("openssl",["x509","-req","-in",join(root,"leaf.csr"),"-CA",join(root,"ca.pem"),"-CAkey",join(root,"ca.key"),"-set_serial",String(name==="trusted"?1:name==="wrong-host"?2:3),"-days","1","-sha256","-extfile",join(root,name+".ext"),"-out",join(root,name+".pem")]);
    }
    const repo=join(root,"fixture.git");gitRun(["init","--bare","--initial-branch=main",repo]);
    writeFileSync(join(root,"empty"),Buffer.alloc(0),{flag:"wx"});
    const tree=gitRun(["-C",repo,"hash-object","-t","tree","-w",join(root,"empty")]).trim();assert.match(tree,/^[a-f0-9]{40}$/);
    const ref=gitRun(["-C",repo,"-c","user.name=Synthetic fixture","-c","user.email=fixture@example.invalid","commit-tree",tree,"-m","Local synthetic commit"]).trim();assert.match(ref,/^[a-f0-9]{40}$/);
    gitRun(["-C",repo,"update-ref","refs/heads/main",ref]);gitRun(["-C",repo,"update-server-info"]);
    const objects=new Map([["/fixture/info/refs",readFileSync(join(repo,"info/refs"))],["/fixture/HEAD",readFileSync(join(repo,"HEAD"))]]);
    for(const id of [tree,ref])objects.set("/fixture/objects/"+id.slice(0,2)+"/"+id.slice(2),readFileSync(join(repo,"objects",id.slice(0,2),id.slice(2))));
    const results=[];
    for(const kind of ["trusted","wrong-host","invalid-extension"]){
      server=createServer({key:readFileSync(join(root,"leaf.key")),cert:readFileSync(join(root,kind+".pem"))},(request,response)=>{const data=objects.get(request.url?.split("?")[0]);if(request.method!=="GET"||!data){response.writeHead(404);response.end();return;}response.writeHead(200,{"Content-Type":"application/octet-stream","Cache-Control":"no-store"});response.end(data);});
      server.maxConnections=8;server.requestTimeout=5000;server.headersTimeout=5000;
      await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error("Loopback server listen timeout")),5000);server.once("error",no);server.listen(0,"127.0.0.1",()=>{clearTimeout(timer);yes();});});
      const url="https://127.0.0.1:"+server.address().port+"/fixture",base=["-c","credential.helper=","-c","http.sslVerify=true"];
      if(kind==="trusted"){
        let refused=false;try{await gitAsync([...base,"ls-remote",url,"refs/heads/main"]);}catch(error){refused=Number.isInteger(error.code)&&error.code!==0&&/certificate|SSL|verification/i.test(String(error.stderr));}assert.ok(refused,"Untrusted CA must be rejected");
        const trusted=["-c","http.sslCAInfo="+join(root,"ca.pem"),...base];assert.equal((await gitAsync([...trusted,"ls-remote",url,"refs/heads/main"])).trim(),ref+"\trefs/heads/main");
        await gitAsync([...trusted,"clone","--no-checkout","--",url,join(root,"https-clone")]);assert.equal(gitRun(["-C",join(root,"https-clone"),"rev-parse","HEAD"]).trim(),ref);
        gitRun(["clone","--no-checkout","--",repo,join(root,"local-clone")]);assert.equal(gitRun(["-C",join(root,"local-clone"),"rev-parse","HEAD"]).trim(),ref);results.push("trusted-CA-HTTPS-ls-remote-and-clone","local-clone","untrusted-CA-rejected");
      }else{let refused=false;try{await gitAsync(["-c","http.sslCAInfo="+join(root,"ca.pem"),...base,"ls-remote",url,"refs/heads/main"]);}catch(error){refused=Number.isInteger(error.code)&&error.code!==0&&/certificate|SSL|verification|subject name/i.test(String(error.stderr));}assert.ok(refused,kind+" must be rejected");results.push(kind+"-rejected");}
      await close();
    }
    success=true;return results;
  }finally{await close();assert.equal(dirname(root),tmpdir());assert.ok(basename(root).startsWith("vaettir-git-openssl-"));if(success)rmSync(root,{recursive:true});/* Failed disposable evidence is retained. */}
}
export async function inspectBuilt(root,sources,config,upstream){
  assert.ok(root.startsWith("/")&&root!=="/");assertSourceIdentity(sources);const features=assertCurlConfiguration(config);
  const certificatePath=join(root,'usr/share/vaettir/git-openssl-sources'),publicCertificate=assertCurlCertificateArtifacts(readFileSync(join(certificatePath,'curl-public-key.response.html')),readFileSync(join(certificatePath,'curl-public-key.gpg')),JSON.parse(readFileSync(join(certificatePath,'curl-public-key-proof.json'))));
  const files=packageFiles(root),elf=files.filter(row=>row.elf);assertPackageELF(elf);
  const git=join(root,"usr/bin/git"),gitExec=join(root,"usr/lib/git-core");assert.equal(command(git,["--version"]).trim(),"git version 2.47.3.vaettir1");
  assertSelectedGitUpstream(upstream.git);assert.ok(upstream.curl.selected.length===5);assert.equal(upstream.curl.exitCode,0);assert.equal(upstream.curl.passed,5);assert.equal(upstream.curl.skipped,0);
  const tls=await checkGitTLS(git,gitExec);
  return{schema:"vaettir-git-openssl-runtime/v1",package:"vaettir-git-openssl",packageVersion:PACKAGE_VERSION,sources,publicCertificate,configuration:features,upstreamTests:upstream,files,tlsChecks:tls,networkScope:"disposable loopback only",wholeImageSecurityAcceptance:false};
}
async function installed(){
  const root="/usr/share/vaettir",proof=JSON.parse(readFileSync(join(root,"git-openssl-runtime-proof.json"),"utf8"));assert.equal(proof.schema,"vaettir-git-openssl-runtime/v1");assert.equal(proof.packageVersion,PACKAGE_VERSION);assertSourceIdentity(proof.sources);assertCurlConfiguration(JSON.parse(readFileSync(join(root,"git-openssl-curl-config.json"),"utf8")));
  const packagedSources=JSON.parse(readFileSync(join(root,"git-openssl-source-manifest.json"),"utf8"));assertSourceIdentity(packagedSources);assert.deepEqual(packagedSources,proof.sources);
  const certificatePath='/usr/share/vaettir/git-openssl-sources',publicCertificate=assertCurlCertificateArtifacts(readFileSync(join(certificatePath,'curl-public-key.response.html')),readFileSync(join(certificatePath,'curl-public-key.gpg')),JSON.parse(readFileSync(join(certificatePath,'curl-public-key-proof.json'))));assert.deepEqual(proof.publicCertificate,publicCertificate);
  assert.deepEqual(JSON.parse(readFileSync(join(root,"git-openssl-upstream-tests.json"),"utf8")),proof.upstreamTests);
  for(const name of ["git","curl"])assertSignature(readFileSync(join(root,"git-openssl-"+name+"-signature.status"),"utf8"),expectedSources[name].signer);
  assertAbsentFamilies(readFileSync("/var/lib/dpkg/status","utf8"));assert.equal(command("dpkg-query",["-W","-f=${Version}","vaettir-git-openssl"]),PACKAGE_VERSION);
  for(const row of proof.files){assert.ok(row.path.startsWith("usr/")&&!row.path.includes(".."));const path="/"+row.path;if(row.type==="symlink")assert.equal(readlinkSync(path),row.target);else{const data=readFileSync(path);assert.equal(data.length,row.size);assert.equal(sha(data),row.sha256);}}
  // Check forbidden runtime family names, not just package-version labels.
  for(const directory of ["/usr/lib/x86_64-linux-gnu","/lib/x86_64-linux-gnu","/usr/local/lib"]){let names;try{names=readdirSync(directory);}catch(error){if(error.code==="ENOENT")continue;throw error;}assert.ok(!names.some(name=>/^(?:lib(?:gnutls|gssapi_krb5|krb5|k5crypto|ldap|lber|sasl2|rtmp|ngtcp2_crypto_gnutls)|krb5|sasl2)(?:\.|$)/.test(name)),"Forbidden library family path remains");}
  assertPackageELF(proof.files.filter(row=>row.elf));return{schema:"vaettir-git-openssl-installed/v1",packageVersion:PACKAGE_VERSION,packageBytesMatchBuildReceipt:true,absentFamilyDpkgAndPaths:true,tlsChecks:await checkGitTLS("/usr/bin/git","/usr/lib/git-core"),wholeImageSecurityAcceptance:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const deadline=setTimeout(()=>process.exit(1),180000);
  try{
    let proof;if(process.argv.length===3&&process.argv[2]==="--installed")proof=await installed();
    else if(process.argv.length===6&&process.argv[2]==="--built"){
      const [root,sourcesDir,checksDir]=process.argv.slice(3),sources={...JSON.parse(readFileSync(join(sourcesDir,"git/source-manifest.json"))),...JSON.parse(readFileSync(join(sourcesDir,"curl/source-manifest.json")))};
      for(const name of ["git","curl"])assertSignature(readFileSync(join(checksDir,name+"-source-signature.status"),"utf8"),expectedSources[name].signer);
      proof=await inspectBuilt(root,sources,JSON.parse(readFileSync(join(checksDir,"curl-config.json"))),JSON.parse(readFileSync(join(checksDir,"upstream-tests.json"))));
    }else throw Error("Expected --installed or --built PACKAGE_ROOT SOURCES_DIR CHECKS_DIR");
    console.log(JSON.stringify(proof,null,2));
  }finally{clearTimeout(deadline);}
}
