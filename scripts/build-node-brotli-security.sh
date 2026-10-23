#!/bin/sh
set -eu
input=${1:?Pinned source input directory required}
build=${2:?Fresh build directory required}
scripts=${3:?Repository scripts directory required}
for p in "$input" "$build" "$scripts"; do case "$p" in /*) : ;; *) exit 2 ;; esac; done
test ! -e "$build"
mkdir -p "$build/gpg" "$build/proof/node/bin" "$build/proof/packages" "$build/proof/receipts" "$build/proof/sources"
node --input-type=module - "$scripts" "$input" <<'PINS'
import{readFileSync}from'node:fs';import{join}from'node:path';import{createHash}from'node:crypto';
const scripts=process.argv[2],root=process.argv[3],m=JSON.parse(readFileSync(join(scripts,'node-brotli-runtime-sources.json'))),sha=b=>createHash('sha256').update(b).digest('hex');
for(const f of m.brotli.files){const b=readFileSync(join(root,f.name));if(b.length!==f.bytes||sha(b)!==f.sha256)throw Error('Brotli input differs');}
const n=m.node;for(const[file,pin]of [[n.archive,n.archiveSha256],['SHASUMS256.txt',n.checksumsSha256],['SHASUMS256.txt.sig',n.signatureSha256]])if(sha(readFileSync(join(root,file)))!==pin)throw Error('Node input differs');
if(sha(readFileSync(join(scripts,'public-keys/node-'+n.signer+'.asc')))!==n.publicKeySha256)throw Error('Node public key differs');
PINS
gpg --no-options --homedir "$build/gpg" --batch --no-autostart --dearmor --output "$build/node-release.gpg" "$scripts/public-keys/node-5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.asc"
gpgv --homedir "$build/gpg" --keyring "$build/node-release.gpg" --status-fd 1 "$input/SHASUMS256.txt.sig" "$input/SHASUMS256.txt" > "$build/proof/receipts/node-signature.status"
grep -q '^\[GNUPG:\] VALIDSIG 5BE8A3F6C8A5C01D106C0AD820B1A390B168D356 ' "$build/proof/receipts/node-signature.status"
grep ' node-v22.23.4-linux-x64.tar.xz$' "$input/SHASUMS256.txt" > "$build/node-archive.sha256"
test "$(wc -l < "$build/node-archive.sha256")" -eq 1
(cd "$input" && sha256sum --check "$build/node-archive.sha256")
tar -xJf "$input/node-v22.23.4-linux-x64.tar.xz" -C "$build/proof/node" --strip-components=1 node-v22.23.4-linux-x64/bin/node node-v22.23.4-linux-x64/LICENSE
printf '%s  %s\n' 94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90 "$build/proof/node/bin/node" | sha256sum --check
printf '%s  %s\n' c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4 "$build/proof/node/LICENSE" | sha256sum --check
timeout 10 "$build/proof/node/bin/node" "$scripts/check-node-security-runtime.mjs" > "$build/proof/receipts/node-regression.json"
gpgv --keyring /usr/share/keyrings/debian-keyring.gpg --keyring /usr/share/keyrings/debian-maintainers.gpg --status-fd 1 "$input/brotli_1.1.0-2.dsc" > "$build/proof/receipts/brotli-source-signature.status"
grep -q '^\[GNUPG:\] VALIDSIG 92978A6E195E4921825F7FF0F34F09744E9F5DD9 ' "$build/proof/receipts/brotli-source-signature.status"
dpkg-source -x "$input/brotli_1.1.0-2.dsc" "$build/source"
node "$scripts/retain-brotli-test-corpus.mjs" "$input/testdata" "$build/source"
cp -a "$build/source" "$build/unpatched"
cp "$input/da9806362874b9bd4b552a3af360b5d6347beb12.patch" "$build/source/debian/patches/vaettir-block-switch.patch"
cd "$build/source"
printf '%s\n' vaettir-block-switch.patch >> debian/patches/series
patch --batch --fuzz=0 -p1 --dry-run < debian/patches/vaettir-block-switch.patch
dpkg-source --before-build .
node --input-type=module - "$build/source/debian/changelog" <<'CHANGELOG'
import{readFileSync,writeFileSync}from'node:fs';const p=process.argv[2],old=readFileSync(p,'utf8');if(!old.startsWith('brotli (1.1.0-2) '))throw Error('Unexpected Debian source');writeFileSync(p,`brotli (1.1.0-2+vaettir1) trixie; urgency=high

  * Backport upstream da980636 for CVE-2026-111497. Keep Debian packaging,
    SONAMEs and exports; verify the native whole-input and streamed regression.

 -- Vaettir Runtime Build <runtime-build@skaldandstone.com>  Fri, 23 Oct 2026 00:00:00 +0000

${old}`);
CHANGELOG
timeout 600 env DEB_BUILD_OPTIONS=parallel=2 DEB_BUILD_PROFILES=nopython dpkg-buildpackage -b -us -uc > "$build/proof/receipts/brotli-package-build.log" 2>&1
dpkg-source --before-build .
patch --batch --fuzz=0 -R -p1 --dry-run < debian/patches/vaettir-block-switch.patch
package="$build/libbrotli1_1.1.0-2+vaettir1_amd64.deb"
test "$(dpkg-deb -f "$package" Package)" = libbrotli1
test "$(dpkg-deb -f "$package" Version)" = 1.1.0-2+vaettir1
test "$(dpkg-deb -f "$package" Architecture)" = amd64
dpkg-deb -x "$package" "$build/runtime"
lib="$build/runtime/usr/lib/x86_64-linux-gnu"
cc -O2 -Wall -Wextra -Werror -I "$build/source/c/include" "$scripts/check-brotli-block-switch.c" "$lib/libbrotlidec.so.1.1.0" "$lib/libbrotlicommon.so.1.1.0" -o "$build/proof/receipts/check-brotli-block-switch"
timeout 10 env LD_LIBRARY_PATH="$lib" "$build/proof/receipts/check-brotli-block-switch" > "$build/proof/receipts/brotli-regression.txt"
# Keep the unpatched control separate, with a bounded process and output buffer.
cmake -S "$build/unpatched" -B "$build/unpatched-build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DBROTLI_DISABLE_TESTS=OFF > "$build/unpatched-configure.log"
timeout 300 cmake --build "$build/unpatched-build" --parallel 2 > "$build/unpatched-build.log" 2>&1
cc -O2 -Wall -Wextra -Werror -I "$build/unpatched/c/include" "$scripts/check-brotli-block-switch.c" "$build/unpatched-build/libbrotlidec.so.1.1.0" "$build/unpatched-build/libbrotlicommon.so.1.1.0" -o "$build/unpatched-regression"
set +e
timeout 10 env LD_LIBRARY_PATH="$build/unpatched-build" "$build/unpatched-regression" > "$build/proof/receipts/brotli-negative-control.txt" 2>&1
negative=$?
set -e
test "$negative" -eq 42
grep -q '^BROTLI_BLOCK_SWITCH_REJECTED ' "$build/proof/receipts/brotli-negative-control.txt"
# Run the complete CMake test inventory fail-hard. Debian's profile selects C/C++ only.
cmake -S "$build/source" -B "$build/fixed-tests" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DBROTLI_DISABLE_TESTS=OFF > "$build/fixed-configure.log"
timeout 300 cmake --build "$build/fixed-tests" --parallel 2 > "$build/fixed-build.log" 2>&1
ctest --test-dir "$build/fixed-tests" --show-only=json-v1 > "$build/proof/receipts/brotli-test-inventory.json"
node -e "const t=require(process.argv[1]).tests;if(!Array.isArray(t)||t.length<1)throw Error('Native tests missing')" "$build/proof/receipts/brotli-test-inventory.json"
timeout 300 ctest --test-dir "$build/fixed-tests" --output-on-failure --timeout 30 --parallel 2 > "$build/proof/receipts/brotli-native-tests.log" 2>&1
node "$scripts/record-brotli-security-proof.mjs" "$build" "$scripts"
cp "$package" "$build/proof/packages/"
cp "$input/brotli_1.1.0-2.dsc" "$input/brotli_1.1.0.orig.tar.gz" "$input/brotli_1.1.0-2.debian.tar.xz" "$input/da9806362874b9bd4b552a3af360b5d6347beb12.patch" "$input/SHASUMS256.txt" "$input/SHASUMS256.txt.sig" "$build/proof/sources/"
cp "$scripts/public-keys/node-5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.asc" "$scripts/node-brotli-runtime-sources.json" "$scripts/check-node-security-runtime.mjs" "$scripts/check-brotli-block-switch.c" "$build/proof/sources/"
cp "$scripts/brotli-runtime-test-corpus.json" "$build/proof/sources/"
