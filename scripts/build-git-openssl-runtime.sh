#!/bin/sh
set -eu
# Fresh isolated build only. Debian source/patches remain intact; no global ABI replacement.
source_dir=${1:?Supply /build/git-curl-sources}
build_root=${2:?Supply a fresh isolated build directory}
checker=${3:?Supply the absolute check-git-openssl-runtime.mjs path}
for path in "$source_dir" "$build_root" "$checker"; do
  case "$path" in /|*'/../'*|*'/./'*) echo 'Unsafe build path' >&2; exit 1 ;; /*) : ;; *) echo 'Absolute build paths required' >&2; exit 1 ;; esac
done
test ! -e "$build_root"
test "$(dpkg --print-architecture)" = amd64
mkdir "$build_root"
mkdir "$build_root/checks"
checks="$build_root/checks"
cd "$source_dir/git"
sha256sum --check <<'GIT_PINS'
41ee783af84774dfab31ff6af54a07f70513dd09914e2d622626f4dfecae0a86  git_2.47.3-0+deb13u1.dsc
9c2eb1250781b3e5bfef098572d07fdf132d67e6c065e4307332ade9819a1501  git_2.47.3.orig.tar.xz
db44b90ab928d41959f5945a49fcaa101385a4bd085b118b5fd40162a0a84066  git_2.47.3-0+deb13u1.debian.tar.xz
GIT_PINS
gpgv --keyring /usr/share/keyrings/debian-keyring.gpg --keyring /usr/share/keyrings/debian-maintainers.gpg --status-fd 1 git_2.47.3-0+deb13u1.dsc > "$checks/git-source-signature.status"
grep -q '^\[GNUPG:\] VALIDSIG 3AFA757FAC6EA11D2FF45DF088D24287A2D898B1 ' "$checks/git-source-signature.status"
cd "$source_dir/curl"
sha256sum --check <<'CURL_PINS'
d0f6459057c3a2ed349e219a5e44c10b77c6e40ecbccf7ec45b010eb3c4a2c34  curl_8.21.0-2~bpo13+1.dsc
d9b327997999045a24cda50f3983e69e51c516bd8be6ef9842fc7f99135e33bb  curl_8.21.0.orig.tar.gz
0f446cb09f584862ae541b79cea53149f1be0d25ef31f2c482c0e7160250fa27  curl_8.21.0.orig.tar.gz.asc
d13ebcfd5824d545e139a5426fa403f8cce42c7ea7ef87325913c68a31133d73  curl_8.21.0-2~bpo13+1.debian.tar.xz
CURL_PINS
gpgv --keyring /usr/share/keyrings/debian-keyring.gpg --keyring /usr/share/keyrings/debian-maintainers.gpg --status-fd 1 curl_8.21.0-2~bpo13+1.dsc > "$checks/curl-source-signature.status"
grep -q '^\[GNUPG:\] VALIDSIG 05DB6A837E105F4B1D02C55FBBA9FAADCCFB4707 ' "$checks/curl-source-signature.status"
dpkg-source -x "$source_dir/curl/curl_8.21.0-2~bpo13+1.dsc" "$build_root/curl-source"
dpkg-source -x "$source_dir/git/git_2.47.3-0+deb13u1.dsc" "$build_root/git-source"
cd "$build_root/curl-source"
test "$(dpkg-parsechangelog --show-field Version)" = '8.21.0-2~bpo13+1'
timeout 120 autoreconf -fi > "$checks/curl-autoreconf.log" 2>&1
curl_prefix="$build_root/curl-prefix"
# Only HTTP/HTTPS, with dynamic system OpenSSL+nghttp2 and a static libcurl archive.
# RTMP is absent from this curl version; actual protocols and ELF receipts gate absence.
timeout 180 env CFLAGS="$(dpkg-buildflags --get CFLAGS)" CPPFLAGS="$(dpkg-buildflags --get CPPFLAGS)" LDFLAGS="$(dpkg-buildflags --get LDFLAGS)" \
  ./configure --prefix="$curl_prefix" --disable-shared --enable-static --with-openssl --with-zlib --with-nghttp2 \
  --with-ca-bundle=/etc/ssl/certs/ca-certificates.crt --with-ca-path=/etc/ssl/certs \
  --without-gnutls --without-mbedtls --without-wolfssl --without-rustls \
  --without-gssapi --without-libgsasl --without-libssh --without-libssh2 --without-ngtcp2 --without-nghttp3 --without-quiche \
  --without-brotli --without-zstd --without-libpsl --without-libidn2 \
  --disable-ldap --disable-ldaps --disable-negotiate-auth --disable-ntlm --disable-tls-srp \
  --disable-dict --disable-file --disable-ftp --disable-gopher --disable-imap --disable-mqtt --disable-pop3 --disable-rtsp --disable-smb --disable-smtp --disable-telnet --disable-tftp --disable-ipfs --disable-websockets --disable-docs \
  > "$checks/curl-configure.log" 2>&1
if grep -q 'unrecognized options' "$checks/curl-configure.log"; then echo 'Unexpected curl configure option' >&2; exit 1; fi
timeout 600 make -j2 > "$checks/curl-build.log" 2>&1
timeout 300 make -C tests test TFLAGS='-a 1 2 3 4 5' > "$checks/curl-upstream.log" 2>&1
timeout 120 make install > "$checks/curl-install.log" 2>&1
test -f "$curl_prefix/lib/libcurl.a"
test ! -e "$curl_prefix/lib/libcurl.so"
node --input-type=module - "$curl_prefix" "$checks" <<'CURL_METADATA'
import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import {join} from 'node:path';
const [prefix,checks]=process.argv.slice(2),program=join(prefix,'bin/curl-config');
const get=flag=>execFileSync(program,[flag],{encoding:'utf8',timeout:10000,maxBuffer:16384}).trim();
writeFileSync(join(checks,'curl-config.json'),JSON.stringify({version:get('--version'),sslBackends:get('--ssl-backends'),protocols:get('--protocols'),features:get('--features'),staticLibs:get('--static-libs')},null,2)+'\n',{flag:'wx'});
CURL_METADATA
cd "$build_root/git-source"
test "$(dpkg-parsechangelog --show-field Version)" = '1:2.47.3-0+deb13u1'
curl_libs=$("$curl_prefix/bin/curl-config" --static-libs)
git_cflags=$(dpkg-buildflags --get CFLAGS)
git_cppflags=$(dpkg-buildflags --get CPPFLAGS)
git_ldflags=$(dpkg-buildflags --get LDFLAGS)
set -- prefix=/usr gitexecdir=/usr/lib/git-core GIT_VERSION=2.47.3.vaettir1 \
  CURL_CONFIG="$curl_prefix/bin/curl-config" CURL_CFLAGS="-I$curl_prefix/include" CURL_LDFLAGS="$curl_libs" \
  CFLAGS="$git_cflags" EXTRA_CPPFLAGS="$git_cppflags" LDFLAGS="$git_ldflags" \
  NO_TCLTK=YesPlease NO_GETTEXT=YesPlease NO_PYTHON=YesPlease NO_INSTALL_HARDLINKS=YesPlease USE_LIBPCRE2=YesPlease
timeout 600 make -j2 "$@" all > "$checks/git-build.log" 2>&1
# Selected local upstream suites only. All optional skips are retained and reported;
# this is not the entire Git test suite or a provider/production test.
for suite in t0001-init.sh t1000-read-tree.sh t5601-clone.sh; do
  (cd t; timeout 180 sh "$suite") > "$checks/$suite.log" 2>&1
done
package_root="$build_root/package"
mkdir "$package_root"
timeout 120 make "$@" DESTDIR="$package_root" install > "$checks/git-install.log" 2>&1
mkdir -p "$package_root/usr/lib/vaettir/git-openssl" "$package_root/usr/share/vaettir"
cp "$curl_prefix/bin/curl" "$package_root/usr/lib/vaettir/git-openssl/curl"
# Retain the exact signed corresponding source, build instructions and notices.
# This package is an internal runtime artifact, not a public distribution action.
source_bundle="$package_root/usr/share/doc/vaettir-git-openssl/sources"
mkdir -p "$source_bundle/git" "$source_bundle/curl"
cp "$source_dir/git"/git_* "$source_bundle/git/"
cp "$source_dir/curl"/curl_* "$source_bundle/curl/"
cp "$source_dir/git/source-manifest.json" "$source_bundle/git/"
cp "$source_dir/curl/source-manifest.json" "$source_bundle/curl/"
cp "$build_root/git-source/COPYING" "$source_bundle/git/"
cp "$build_root/git-source/debian/copyright" "$source_bundle/git/debian-copyright"
cp "$build_root/curl-source/COPYING" "$source_bundle/curl/"
cp "$build_root/curl-source/debian/copyright" "$source_bundle/curl/debian-copyright"
cp "$0" "$checker" "$(dirname "$checker")/git-openssl-sources.json" "$(dirname "$checker")/fetch-git-openssl-sources.mjs" "$source_bundle/"
node --input-type=module - "$checks" <<'TEST_METADATA'
import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
const root=process.argv[2],git=['t0001-init.sh','t1000-read-tree.sh','t5601-clone.sh'].map(name=>{const log=readFileSync(join(root,name+'.log'),'utf8'),lines=log.split(/\r?\n/);assert.ok(!lines.some(line=>/^not ok\b/.test(line)));const passed=lines.filter(line=>/^ok \d+\b/.test(line)&&!/# SKIP/i.test(line)).length,skipped=lines.filter(line=>/^ok \d+\b.*# SKIP/i.test(line)).length;assert.ok(passed>0);return{name,exitCode:0,passed,skipped,logSha256:hash(log)};});
const curlLog=readFileSync(join(root,'curl-upstream.log'),'utf8');assert.match(curlLog,/TESTDONE: 5 tests out of 5 reported OK/);assert.doesNotMatch(curlLog,/TESTFAIL:|IGNORED:|[1-9]\d* tests were skipped/);
writeFileSync(join(root,'upstream-tests.json'),JSON.stringify({git,curl:{selected:[1,2,3,4,5],exitCode:0,passed:5,skipped:0,logSha256:hash(curlLog)},scope:'Selected local upstream tests only; other protocol/features are not exercised.'},null,2)+'\n',{flag:'wx'});
TEST_METADATA
cp "$checks/curl-config.json" "$package_root/usr/share/vaettir/git-openssl-curl-config.json"
cp "$checks/upstream-tests.json" "$package_root/usr/share/vaettir/git-openssl-upstream-tests.json"
cp "$checks/git-source-signature.status" "$package_root/usr/share/vaettir/git-openssl-git-signature.status"
cp "$checks/curl-source-signature.status" "$package_root/usr/share/vaettir/git-openssl-curl-signature.status"
node --input-type=module - "$source_dir" "$package_root/usr/share/vaettir" <<'SOURCE_METADATA'
import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';const [source,out]=process.argv.slice(2);const manifest={...JSON.parse(readFileSync(join(source,'git/source-manifest.json'))),...JSON.parse(readFileSync(join(source,'curl/source-manifest.json')))};writeFileSync(join(out,'git-openssl-source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
SOURCE_METADATA
timeout 180 node "$checker" --built "$package_root" "$source_dir" "$checks" > "$checks/git-openssl-runtime-proof.json"
cp "$checks/git-openssl-runtime-proof.json" "$package_root/usr/share/vaettir/git-openssl-runtime-proof.json"
mkdir "$package_root/DEBIAN"
cat > "$package_root/DEBIAN/control" <<'CONTROL'
Package: vaettir-git-openssl
Version: 1:2.47.3-0+deb13u1+vaettir1
Architecture: amd64
Maintainer: Vaettir Runtime Build <runtime-build@skaldandstone.com>
Provides: git (= 1:2.47.3-0+deb13u1+vaettir1)
Conflicts: git
Replaces: git
Depends: libc6 (>= 2.38), libssl3t64 (>= 3.0.0), libnghttp2-14 (>= 1.50.0), libexpat1 (>= 2.0.1), libpcre2-8-0 (>= 10.34), zlib1g (>= 1:1.2.3.4), perl, liberror-perl
Description: Vaettir Git with maintained Debian patches and isolated static OpenSSL curl
 Git 2.47.3 Debian security source with curl 8.21.0 backports patches.
 HTTP(S) only curl; system OpenSSL/nghttp2 remain dynamic. No global libcurl ABI.
CONTROL
artifact="$build_root/vaettir-git-openssl_2.47.3-0+deb13u1+vaettir1_amd64.deb"
dpkg-deb --root-owner-group --build "$package_root" "$artifact"
test "$(dpkg-deb -f "$artifact" Package)" = vaettir-git-openssl
test "$(dpkg-deb -f "$artifact" Version)" = '1:2.47.3-0+deb13u1+vaettir1'
printf '%s\n' 'Git/OpenSSL source build and loopback receipt complete; whole-image native/scan/release acceptance remains separate.'
