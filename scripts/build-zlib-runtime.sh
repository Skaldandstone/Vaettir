#!/bin/sh
set -eu
source_dir=${1:?Supply the pinned zlib source directory}
build_root=${2:?Supply a fresh isolated zlib build directory}
checker=${3:?Supply the absolute check-zlib-runtime.mjs path}
regression=${4:?Supply the absolute zlib-runtime-regression.c path}
for path in "$source_dir" "$build_root" "$checker" "$regression"; do
  case "$path" in /*) : ;; *) echo 'Build paths must be absolute' >&2; exit 1 ;; esac
done
test ! -e "$build_root/source"
mkdir -p "$build_root"
cd "$source_dir"
sha256sum --check <<'PINS'
46de917397a3bda8c3b812b118e25d38044a9e161fce5e35f850f4159eb0f0de  zlib_1.3.dfsg+really1.3.2-3.dsc
7b6903eb019983987b7112eccf90f1703f1c6c0e0cede36564bf611d19ca579d  zlib_1.3.dfsg+really1.3.2.orig.tar.gz
48f7309bccf9c81e9f68a7e22cf06e08a1f70b275535b953632fccb525c5439e  zlib_1.3.dfsg+really1.3.2-3.debian.tar.xz
110ff14375733173d8aa54574473424fbd7dfe4b81f1ca34a759c6fe14b15b14  df84af25dc1942490e1d1c899a07619152a46148.patch
PINS
gpgv --keyring /usr/share/keyrings/debian-keyring.gpg \
  --keyring /usr/share/keyrings/debian-maintainers.gpg --status-fd 1 \
  zlib_1.3.dfsg+really1.3.2-3.dsc > "$build_root/zlib-source-signature.status"
grep -q '^\[GNUPG:\] VALIDSIG ADE668AA675718B59FE29FEA24D68B725D5487D0 ' "$build_root/zlib-source-signature.status"
dpkg-source -x "$source_dir/zlib_1.3.dfsg+really1.3.2-3.dsc" "$build_root/source"
# Retain a bounded synthetic negative control, never copied into the runtime.
cp -a "$build_root/source" "$build_root/unpatched"
cp "$source_dir/df84af25dc1942490e1d1c899a07619152a46148.patch" "$build_root/source/debian/patches/vaettir-gzwrite-recovery.patch"
cd "$build_root/source"
test "$(grep -c '^minizip-' debian/patches/series)" = 2
printf '%s\n' 'vaettir-gzwrite-recovery.patch' >> debian/patches/series
# Require exact context, then let Debian maintain its quilt backup/state rather
# than manufacturing an applied-patches marker without reversal metadata.
patch --batch --fuzz=0 -p1 --dry-run < debian/patches/vaettir-gzwrite-recovery.patch
dpkg-source --before-build .
node --input-type=module - "$build_root/source" <<'CHANGELOG'
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const file=join(process.argv[2],'debian/changelog'), old=readFileSync(file,'utf8');
if(!old.startsWith('zlib (1:1.3.dfsg+really1.3.2-3) ')) throw Error('Unexpected zlib source version');
writeFileSync(file,`zlib (1:1.3.dfsg+really1.3.2-3+vaettir1) trixie; urgency=medium

  * Local compatible runtime rebuild: retain maintained Debian patches and
    apply upstream df84af25 for CVE-2026-85091 nonblocking gzwrite recovery.
    Preserve libz.so.1 and existing versioned exports; validate synthetic
    error recovery with an instrumented library and the actual runtime package.

 -- Vaettir Runtime Build <runtime-build@skaldandstone.com>  Fri, 02 Oct 2026 00:00:00 +0000

${old}`);
CHANGELOG
timeout 600 env DEB_BUILD_OPTIONS=parallel=2 DEB_BUILD_PROFILES=nobiarch dpkg-buildpackage -b -us -uc
# Debian's maintained rules prefix main upstream tests with '-'. Repeat them
# fail-hard, rather than treating that ignored result as a successful check.
timeout 60 make test
artifact="$build_root/zlib1g_1.3.dfsg+really1.3.2-3+vaettir1_amd64.deb"
test "$(dpkg-deb -f "$artifact" Package)" = zlib1g
test "$(dpkg-deb -f "$artifact" Version)" = '1:1.3.dfsg+really1.3.2-3+vaettir1'
test "$(dpkg-deb -f "$artifact" Architecture)" = amd64
dpkg-deb -x "$artifact" "$build_root/runtime"
library="$build_root/runtime/usr/lib/x86_64-linux-gnu/libz.so.1.3.2"
if test ! -f "$library"; then library="$build_root/runtime/lib/x86_64-linux-gnu/libz.so.1.3.2"; fi
test -f "$library"
baseline=/usr/lib/x86_64-linux-gnu/libz.so.1
test -f "$baseline"
cc -O2 -Wall -Wextra -Werror -I "$build_root/source" "$regression" "$library" -o "$build_root/zlib-runtime-regression"
timeout 30 node "$checker" "$library" "$baseline" "$build_root/zlib-runtime-regression" > "$build_root/zlib-runtime-proof.json"

# Instrument zlib itself, not just a caller linked to an uninstrumented DSO.
for variant in unpatched instrumented; do
  if test "$variant" = instrumented; then cp -a "$build_root/source" "$build_root/instrumented"; fi
  cd "$build_root/$variant"
  if test -f Makefile; then make distclean >/dev/null; fi
  CFLAGS='-O1 -g -fno-omit-frame-pointer -fsanitize=address,undefined' ./configure --static --disable-crcvx
  timeout 180 make -j2
  cc -O1 -g -Wall -Wextra -Werror -fno-omit-frame-pointer -fsanitize=address,undefined \
    -I . "$regression" ./libz.a -o "$build_root/zlib-$variant-regression"
done
cd "$build_root"
node --input-type=module - "$build_root" "$checker" <<'SANITIZERS'
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const {requireZlibNegativeControl}=await import(pathToFileURL(process.argv[3]).href);
const root=process.argv[2];
const options={timeout:20000,maxBuffer:32768,encoding:'utf8',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',ASAN_OPTIONS:'abort_on_error=1:detect_leaks=1',UBSAN_OPTIONS:'halt_on_error=1:print_stacktrace=1'}};
let reproduced=false;
try { execFileSync(join(root,'zlib-unpatched-regression'),['--nonblocking'],options); }
catch(error) {
  const diagnostic=String(error.stderr??'');
  writeFileSync(join(root,'zlib-negative-control.txt'),diagnostic);
  reproduced=requireZlibNegativeControl({diagnostic,status:error.status,signal:error.signal}).reproduced;
}
if(!reproduced) throw Error('Unpatched negative control did not reproduce the specific gz_write memory defect');
const fixed=execFileSync(join(root,'zlib-instrumented-regression'),[],options);
writeFileSync(join(root,'zlib-sanitizer-proof.txt'),'Instrumented zlib ASAN/UBSAN passed; unpatched negative control reproduced gz_write memory defect.\n'+fixed);
SANITIZERS
cat "$build_root/zlib-runtime-proof.json"
cat "$build_root/zlib-sanitizer-proof.txt"
