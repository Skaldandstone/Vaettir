import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {assertSourceIdentity,assertSignature,assertCurlConfiguration,assertPackageELF,assertAbsentFamilies,publicBuildFailureDiagnostics,PUBLIC_BUILD_STAGES,PUBLIC_BUILD_LOGS} from './check-git-openssl-runtime.mjs';
import {sourcePins} from './fetch-git-openssl-sources.mjs';
const config={version:'libcurl 8.22.0',sslBackends:'OpenSSL',protocols:'HTTP HTTPS',features:'SSL HTTP2',staticLibs:'/isolated/lib/libcurl.a -lssl -lcrypto -lnghttp2 -lz'};
test('exact source signatures and closed OpenSSL protocol feature contract',()=>{
  assertSourceIdentity(structuredClone(sourcePins));assertSignature('[GNUPG:] VALIDSIG '+sourcePins.git.signer+' 2026',sourcePins.git.signer);assertCurlConfiguration(config);
  assert.throws(()=>assertSignature('[GNUPG:] VALIDSIG '+sourcePins.curl.signer,sourcePins.git.signer));assert.throws(()=>assertSignature('[GNUPG:] BADSIG x\n[GNUPG:] VALIDSIG '+sourcePins.git.signer,sourcePins.git.signer));
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
