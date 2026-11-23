#!/bin/sh
set -eu
input=${1:?Absolute input directory required}
build=${2:?Fresh absolute build directory required}
scripts=${3:?Absolute scripts directory required}
for p in "$input" "$build" "$scripts"; do case "$p" in /|*'/../'*|*'/./'*) exit 2 ;; /*) : ;; *) exit 2 ;; esac; done
test ! -e "$build"
mkdir -p "$build/proof" "$build/packages" "$build/patches"
node --input-type=module - "$input" "$scripts" <<'VERIFY'
import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{join}from'node:path';
const[input,scripts]=process.argv.slice(2),m=JSON.parse(readFileSync(join(scripts,'openssl-runtime-sources.json')));
for(const p of [...m.files,...m.patches]){const b=readFileSync(join(input,p.name));if(b.length!==p.bytes||createHash('sha256').update(b).digest('hex')!==p.sha256)throw Error('OpenSSL input changed');}
VERIFY
gpgv --keyring /usr/share/keyrings/debian-keyring.gpg --keyring /usr/share/keyrings/debian-maintainers.gpg --status-fd 1 "$input/openssl_3.5.9-1~deb13u1.dsc" > "$build/proof/source-signature.status"
grep -q '^\[GNUPG:\] VALIDSIG 57892E705233051337F6FDD105641F175712FA5B ' "$build/proof/source-signature.status"
dpkg-source -x "$input/openssl_3.5.9-1~deb13u1.dsc" "$build/source"
cd "$build/source"
dpkg-source --before-build .
node --input-type=module - "$scripts" "$input" "$build" <<'PATCHES' > "$build/patch-list"
import{readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';import{createHash}from'node:crypto';import assert from'node:assert/strict';
const[scripts,input,build]=process.argv.slice(2),m=JSON.parse(readFileSync(join(scripts,'openssl-runtime-sources.json')));
for(const p of m.patches){let b=readFileSync(join(input,p.name));if(p.contextSha256){
  // Only a context line differs in 3.5's formatting. Upstream +/- lines stay exact.
  const old='         if (t->usage != DANETLS_USAGE_DANE_TA\n',replacement='         if (t->usage != DANETLS_USAGE_DANE_TA || t->selector != DANETLS_SELECTOR_SPKI || t->mtype != DANETLS_MATCHING_FULL || X509_verify(cert, t->spki) <= 0)\n',text=b.toString('utf8');
  assert.equal(text.split(old).length,2);const adapted=Buffer.from(text.replace(old,replacement));
  assert.deepEqual(adapted.toString('utf8').split('\n').filter(l=>/^[+-]/.test(l)),text.split('\n').filter(l=>/^[+-]/.test(l)));
  assert.equal(createHash('sha256').update(adapted).digest('hex'),p.contextSha256);b=adapted;
}writeFileSync(join(build,'patches',p.name),b,{flag:'wx'});console.log(p.cve+' '+p.name);}
PATCHES
while read -r cve filename; do
  patch --batch --fuzz=0 -p1 --dry-run < "$build/patches/$filename"
  cp "$build/patches/$filename" "debian/patches/vaettir-$cve-$filename"
  printf '%s\n' "vaettir-$cve-$filename" >> debian/patches/series
  dpkg-source --before-build .
done < "$build/patch-list"
node --input-type=module - <<'CHANGELOG'
import{readFileSync,writeFileSync}from'node:fs';const p='debian/changelog',old=readFileSync(p,'utf8');if(!old.startsWith('openssl (3.5.9-1~deb13u1)'))throw Error('Unexpected OpenSSL packaging');writeFileSync(p,`openssl (3.5.9-1~deb13u1+vaettir1) trixie; urgency=high

  * Backport the published OpenSSL 3.5 security fixes using pinned
    upstream commits. Retain Debian configuration and the complete test suite.

 -- Vaettir Runtime Build <runtime-build@skaldandstone.com>  Mon, 23 Nov 2026 00:00:00 +0000

${old}`);
CHANGELOG
for lib in libcrypto.so.3 libssl.so.3; do
  nm -D --defined-only "/usr/lib/x86_64-linux-gnu/$lib" | awk '{print $3}' | sort -u > "$build/proof/$lib.baseline-exports"
  readelf -d "/usr/lib/x86_64-linux-gnu/$lib" > "$build/proof/$lib.baseline-dynamic"
done
timeout 2400 env DEB_BUILD_OPTIONS=parallel=8 dpkg-buildpackage -B -us -uc > "$build/proof/package-build.log" 2>&1 || { tail -n 70 "$build/proof/package-build.log"; exit 1; }
for package in openssl libssl3t64 openssl-provider-legacy; do
  file="$build/${package}_3.5.9-1~deb13u1+vaettir1_amd64.deb"
  test "$(dpkg-deb -f "$file" Package)" = "$package"
  test "$(dpkg-deb -f "$file" Version)" = '3.5.9-1~deb13u1+vaettir1'
  dpkg-deb -x "$file" "$build/extracted"
  cp "$file" "$build/packages/"
done
for lib in libcrypto.so.3 libssl.so.3; do
  candidate="$build/extracted/usr/lib/x86_64-linux-gnu/$lib"
  nm -D --defined-only "$candidate" | awk '{print $3}' | sort -u > "$build/proof/$lib.candidate-exports"
  test -z "$(comm -23 "$build/proof/$lib.baseline-exports" "$build/proof/$lib.candidate-exports")"
  readelf -d "$candidate" | grep -F "Library soname: [$lib]"
done
cp "$scripts/openssl-runtime-sources.json" "$build/proof/"
sha256sum "$build/packages/"*.deb "$build/extracted/usr/lib/x86_64-linux-gnu/"lib*.so.3 > "$build/proof/artifact-sha256.txt"
printf '%s\n' 'OpenSSL signed source, exact upstream patches, full Debian tests and baseline symbol/SONAME checks passed.'
