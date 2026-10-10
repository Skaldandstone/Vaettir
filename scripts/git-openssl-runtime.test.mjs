import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {assertSourceIdentity,assertSignature,assertCurlConfiguration,assertPackageELF,assertAbsentFamilies,publicBuildFailureDiagnostics,PUBLIC_BUILD_STAGES,PUBLIC_BUILD_LOGS,SELECTED_GIT_SUITES,assertSelectedGitUpstream,CURL_PUBLIC_CERTIFICATE,dearmorPublicCertificate,decodePinnedCurlCertificate,fetchPinnedCurlCertificate} from './check-git-openssl-runtime.mjs';
import {sourcePins} from './fetch-git-openssl-sources.mjs';
const config={version:'libcurl 8.22.0',sslBackends:'OpenSSL',protocols:'HTTP HTTPS',features:'SSL HTTP2',staticLibs:'/isolated/lib/libcurl.a -lssl -lcrypto -lnghttp2 -lz'};
test('exact source signatures and closed OpenSSL protocol feature contract',()=>{
  assertSourceIdentity(structuredClone(sourcePins));assertSignature('[GNUPG:] VALIDSIG '+sourcePins.git.signer+' 2026',sourcePins.git.signer);assertCurlConfiguration(config);
  assert.throws(()=>assertSignature('[GNUPG:] VALIDSIG '+sourcePins.curl.signer,sourcePins.git.signer));assert.throws(()=>assertSignature('[GNUPG:] BADSIG x\n[GNUPG:] VALIDSIG '+sourcePins.git.signer,sourcePins.git.signer));
  for(const failure of ['KEYEXPIRED','EXPKEYSIG','REVKEYSIG'])assert.throws(()=>assertSignature('[GNUPG:] '+failure+' x\n[GNUPG:] VALIDSIG '+sourcePins.curl.signer,sourcePins.curl.signer));
  for(const delta of [{sslBackends:'GnuTLS'},{protocols:'HTTP HTTPS FILE'},{features:'SSL HTTP2 GSS-API'},{staticLibs:'-lcurl -lkrb5'}])assert.throws(()=>assertCurlConfiguration({...config,...delta}));
  assert.throws(()=>assertCurlConfiguration({...config,version:'libcurl 8.21.0'}));
  assert.throws(()=>assertCurlConfiguration({...config,version:'libcurl 8.22.0-rc3'}));
  assert.throws(()=>assertCurlConfiguration({...config,features:'SSL HTTP2 TLS-SRP'}));
});
test('package ELF closure and old-family dpkg states fail closed',()=>{
  const rows=[{path:'usr/lib/git-core/git-remote-http',needed:['libssl.so.3','libcrypto.so.3','libc.so.6']}];assertPackageELF(rows);
  assert.throws(()=>assertPackageELF([{...rows[0],needed:['libgnutls.so.30']} ]));
  for(const state of ['installed','config-files','unpacked','half-configured'])assert.throws(()=>assertAbsentFamilies('Package: libgnutls30t64\nStatus: install ok '+state+'\n'));
  assertAbsentFamilies('Package: libssl3t64\nStatus: install ok installed\n');assertAbsentFamilies('Package: libgnutls30t64\nStatus: unknown ok not-installed\n');
});
test('builder and installed checker retain mandatory provenance and real TLS gates',()=>{
  const build=readFileSync(new URL('./build-git-openssl-runtime.sh',import.meta.url),'utf8'),check=readFileSync(new URL('./check-git-openssl-runtime.mjs',import.meta.url),'utf8');
  assert.ok(build.indexOf('SOURCE_METADATA\nstage=PACKAGE_RUNTIME\ntimeout 180 node')>=0);assert.match(build,/dpkg-source -x/);assert.match(build,/--disable-shared --enable-static --with-openssl/);assert.match(build,/--without-gssapi/);assert.match(build,/--disable-ldap --disable-ldaps/);assert.match(build,/logSha256:hash\(log\)/);
  assert.match(check,/await execute\(git,args/);assert.match(check,/Untrusted CA must be rejected/);assert.match(check,/wrong-host/);assert.match(check,/invalid-extension/);assert.match(check,/assert\.deepEqual\(packagedSources,proof.sources\)/);assert.match(check,/proof.upstreamTests/);assert.match(check,/git-openssl-"\+name\+"-signature.status/);assert.match(check,/wholeImageSecurityAcceptance:false/);
  assert.match(build, /source_bundle="\$package_root\/usr\/share\/doc\/vaettir-git-openssl\/sources"/);
  assert.match(build, /git-source\/debian\/copyright/);
  assert.match(build, /curl-source\/debian\/copyright/);
  assert.ok(build.indexOf('source_bundle=') < build.indexOf('timeout 180 node "$checker"'));
  assert.match(build, /Source: git \(1:2.47.3-0\+deb13u1\)/);
  assert.match(build, /Static-Built-Using: curl \(= 8.22.0-1\)/);
  assert.doesNotMatch(build,/--disable-tls-srp/);assert.match(build,/unrecognized options/);assert.match(build,/TFLAGS='-a 1 2 3 4 5'/);
});
test('bounded public build failure diagnostics preserve primary exit and suppress private-looking text',()=>{
  const raw=Buffer.from('make: public compile error\nhttps://example.invalid/?signature=private\nAuthorization: Bearer private\npassword=private\n'+('x'.repeat(9000)));
  const result=publicBuildFailureDiagnostics('CURL_BUILD',2,[{name:'curl-build.log',bytes:raw}]);assert.equal(result.originalExitCode,2);assert.equal(result.failureRetained,true);assert.equal(result.nativeAcceptance,false);assert.equal(result.securityAcceptance,false);assert.ok(Buffer.byteLength(result.excerpts[0].excerpt)<=8192);assert.ok(!JSON.stringify(result).includes('private'));assert.match(result.excerpts[0].excerpt,/make: public compile error/);
  for(const [stage,status,logs]of [['UNKNOWN',2,[]],['CURL_BUILD',0,[]],['CURL_BUILD',2,[{name:'credentials',bytes:Buffer.from('x')}]],['CURL_BUILD',2,[{name:'curl-build.log',bytes:Buffer.alloc(16385)}]]])assert.throws(()=>publicBuildFailureDiagnostics(stage,status,logs));
  assert.ok(Object.isFrozen(PUBLIC_BUILD_STAGES)&&Object.isFrozen(PUBLIC_BUILD_LOGS));const build=readFileSync(new URL('./build-git-openssl-runtime.sh',import.meta.url),'utf8');assert.match(build,/original_status=\$\?/);assert.match(build,/exit "\$original_status"/);assert.match(build,/trap on_exit 0/);assert.match(build,/O_NOFOLLOW/);for(const stage of PUBLIC_BUILD_STAGES)assert.ok(build.includes('stage='+stage));
});
test('Debian static curl metadata remains accepted with isolated linker directory required',()=>{
  const metadata={...config,staticLibs:'-Wl,-Bstatic -lcurl -Wl,-Bdynamic -lssl -lcrypto -lnghttp2 -lz'};assert.equal(assertCurlConfiguration(metadata).tlsBackend,'OpenSSL');
  const build=readFileSync(new URL('./build-git-openssl-runtime.sh',import.meta.url),'utf8');assert.match(build,/CURL_LDFLAGS="-L\$curl_prefix\/lib \$curl_libs"/);assert.match(build,/curl_libs=\$\("\$curl_prefix\/bin\/curl-config" --static-libs\)/);assert.doesNotMatch(build,/CURL_LDFLAGS="\$curl_libs"/);assert.doesNotMatch(build,/CURL_LDFLAGS=.*(?:\/usr\/lib|\/usr\/local\/lib)/);
});
test('Debian CPP hardening never overrides Git internal target-specific definitions',()=>{
  const build=readFileSync(new URL('./build-git-openssl-runtime.sh',import.meta.url),'utf8');assert.match(build,/CFLAGS="\$git_cflags" CPPFLAGS="\$git_cppflags" LDFLAGS="\$git_ldflags"/);assert.doesNotMatch(build,/EXTRA_CPPFLAGS=/);assert.match(build,/git_cppflags=\$\(dpkg-buildflags --get CPPFLAGS\)/);
});
test('exact existing init/read-tree/clone suites are preflighted and consistently recorded',()=>{
  const names=['t0001-init.sh','t1000-read-tree-m-3way.sh','t5601-clone.sh'];assert.deepEqual(SELECTED_GIT_SUITES,names);assert.ok(Object.isFrozen(SELECTED_GIT_SUITES));
  const rows=names.map(name=>({name,exitCode:0,passed:1,skipped:2,logSha256:'a'.repeat(64)}));assertSelectedGitUpstream(rows);for(const mutate of [x=>x[1].name='t1000-read-tree.sh',x=>x.pop(),x=>x[1].exitCode=2,x=>x[1].logSha256='missing']){const copy=structuredClone(rows);mutate(copy);assert.throws(()=>assertSelectedGitUpstream(copy));}
  const build=readFileSync(new URL('./build-git-openssl-runtime.sh',import.meta.url),'utf8'),checker=readFileSync(new URL('./check-git-openssl-runtime.mjs',import.meta.url),'utf8');assert.doesNotMatch(build+checker,/t1000-read-tree\.sh/);
  const preflight='for suite in '+names.join(' ')+'; do\n  test -f "$build_root/git-source/t/$suite"\ndone';assert.ok(build.includes(preflight));assert.ok(build.indexOf(preflight)<build.indexOf('timeout 120 autoreconf'));assert.equal(build.split('for suite in '+names.join(' ')+'; do').length,3);
  for(const name of names){assert.ok(build.includes("'"+name+"'"));assert.ok(PUBLIC_BUILD_LOGS.includes(name+'.log'));}
});
test('canonical public armor dearmor checks CRC24 and rejects private/unknown/duplicate headers',()=>{
  const armor='-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nMTIzNDU2Nzg5\n=Ic8C\n-----END PGP PUBLIC KEY BLOCK-----';assert.equal(dearmorPublicCertificate(Buffer.from(armor)).toString(),'123456789');
  for(const bad of [armor.replace('=Ic8C','=AAAA'),armor.replace('PUBLIC KEY','PRIVATE KEY'),armor.replace('\n\n','\nVersion: arbitrary\n\n'),armor+'\n'+armor,armor.replaceAll('\n','\r\n'),armor.replace('MTIzNDU2Nzg5','MTIzNDU2Nzg5!')])assert.throws(()=>dearmorPublicCertificate(Buffer.from(bad)));
  assert.throws(()=>decodePinnedCurlCertificate(Buffer.from(armor)));assert.ok(Object.isFrozen(CURL_PUBLIC_CERTIFICATE));assert.equal(CURL_PUBLIC_CERTIFICATE.signerFingerprint,'05DB6A837E105F4B1D02C55FBBA9FAADCCFB4707');
});
test('fixed public certificate transport is bounded and cannot fallback or expose raw errors',async()=>{
  await assert.rejects(fetchPinnedCurlCertificate({fetchImpl:async(url,options)=>{assert.equal(url,CURL_PUBLIC_CERTIFICATE.url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);throw Error('private transport text');}}),/Pinned public certificate transport failed/);
  await assert.rejects(fetchPinnedCurlCertificate({fetchImpl:async()=>({status:200,body:[Buffer.alloc(65537)]})}),/Pinned public certificate body rejected/);
  const build=readFileSync(new URL('./build-git-openssl-runtime.sh',import.meta.url),'utf8'),check=readFileSync(new URL('./check-git-openssl-runtime.mjs',import.meta.url),'utf8');assert.match(build,/gpgv --keyring "\$checks\/curl-public-key.gpg" --status-fd 1 curl_8.22.0-1.dsc/);assert.match(build,/gpgv --keyring \/usr\/share\/keyrings\/debian-keyring.gpg --keyring \/usr\/share\/keyrings\/debian-maintainers.gpg --status-fd 1 git_/);assert.ok(build.indexOf('CURL_EARLY_SIGNATURE')<build.indexOf('stage=SOURCE_EXTRACT'));assert.match(build,/openSync\(join\(checks,name\),'wx',0o600\)/);assert.match(build,/fsyncSync\(fd\)/);assert.match(check,/assert.deepEqual\(proof.publicCertificate,publicCertificate\)/);assert.match(check,/KEYEXPIRED\|SIGEXPIRED/);
});
