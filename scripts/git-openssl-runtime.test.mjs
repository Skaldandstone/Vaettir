import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {assertSourceIdentity,assertSignature,assertCurlConfiguration,assertPackageELF,assertAbsentFamilies} from './check-git-openssl-runtime.mjs';
import {sourcePins} from './fetch-git-openssl-sources.mjs';
const config={version:'libcurl 8.21.0',sslBackends:'OpenSSL',protocols:'HTTP HTTPS',features:'SSL HTTP2',staticLibs:'/isolated/lib/libcurl.a -lssl -lcrypto -lnghttp2 -lz'};
test('exact source signatures and closed OpenSSL protocol feature contract',()=>{
  assertSourceIdentity(structuredClone(sourcePins));assertSignature('[GNUPG:] VALIDSIG '+sourcePins.git.signer+' 2026',sourcePins.git.signer);assertCurlConfiguration(config);
  assert.throws(()=>assertSignature('[GNUPG:] VALIDSIG '+sourcePins.curl.signer,sourcePins.git.signer));assert.throws(()=>assertSignature('[GNUPG:] BADSIG x\n[GNUPG:] VALIDSIG '+sourcePins.git.signer,sourcePins.git.signer));
  for(const delta of [{sslBackends:'GnuTLS'},{protocols:'HTTP HTTPS FILE'},{features:'SSL HTTP2 GSS-API'},{staticLibs:'-lcurl -lkrb5'}])assert.throws(()=>assertCurlConfiguration({...config,...delta}));
});
test('package ELF closure and old-family dpkg states fail closed',()=>{
  const rows=[{path:'usr/lib/git-core/git-remote-http',needed:['libssl.so.3','libcrypto.so.3','libc.so.6']}];assertPackageELF(rows);
  assert.throws(()=>assertPackageELF([{...rows[0],needed:['libgnutls.so.30']} ]));
  for(const state of ['installed','config-files','unpacked','half-configured'])assert.throws(()=>assertAbsentFamilies('Package: libgnutls30t64\nStatus: install ok '+state+'\n'));
  assertAbsentFamilies('Package: libssl3t64\nStatus: install ok installed\n');assertAbsentFamilies('Package: libgnutls30t64\nStatus: unknown ok not-installed\n');
});
test('builder and installed checker retain mandatory provenance and real TLS gates',()=>{
  const build=readFileSync(new URL('./build-git-openssl-runtime.sh',import.meta.url),'utf8'),check=readFileSync(new URL('./check-git-openssl-runtime.mjs',import.meta.url),'utf8');
  assert.ok(build.indexOf('SOURCE_METADATA\ntimeout 180 node')>=0);assert.match(build,/dpkg-source -x/);assert.match(build,/--disable-shared --enable-static --with-openssl/);assert.match(build,/--without-gssapi/);assert.match(build,/--disable-ldap --disable-ldaps/);assert.match(build,/logSha256:hash\(log\)/);
  assert.match(check,/await execute\(git,args/);assert.match(check,/Untrusted CA must be rejected/);assert.match(check,/wrong-host/);assert.match(check,/invalid-extension/);assert.match(check,/assert\.deepEqual\(packagedSources,proof.sources\)/);assert.match(check,/proof.upstreamTests/);assert.match(check,/git-openssl-"\+name\+"-signature.status/);assert.match(check,/wholeImageSecurityAcceptance:false/);
  assert.match(build, /source_bundle="\$package_root\/usr\/share\/doc\/vaettir-git-openssl\/sources"/);
  assert.match(build, /git-source\/debian\/copyright/);
  assert.match(build, /curl-source\/debian\/copyright/);
  assert.ok(build.indexOf('source_bundle=') < build.indexOf('timeout 180 node "$checker"'));
});
