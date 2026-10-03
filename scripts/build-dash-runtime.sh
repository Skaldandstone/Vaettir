#!/bin/sh
set -eu

# Build the maintained Debian source and patches. Only the vulnerable internal
# matcher configuration changes; package identity records the local rebuild.
source_dir=${1:?Supply the pinned Dash source directory}
build_root=${2:?Supply a fresh isolated Dash build directory}
checker=${3:?Supply the absolute check-dash-runtime.mjs path}
for path in "$source_dir" "$build_root" "$checker"; do
  case "$path" in /*) : ;; *) echo 'Build paths must be absolute' >&2; exit 1 ;; esac
done
test ! -e "$build_root/source"
mkdir -p "$build_root"
cd "$source_dir"
sha256sum --check <<'PINS'
589efc4d87a4ae4745c273bdb33198d7c4f28a71736a8ece81d3677cf9c6e5ce  dash_0.5.12-12.dsc
6a474ac46e8b0b32916c4c60df694c82058d3297d8b385b74508030ca4a8f28a  dash_0.5.12.orig.tar.gz
a278acb5d9a1f5d9a086d36a547287cbf3105b8f33c0e62d86d264decf5ba1ad  dash_0.5.12-12.debian.tar.xz
PINS
gpgv --keyring /usr/share/keyrings/debian-keyring.gpg \
  --keyring /usr/share/keyrings/debian-maintainers.gpg --status-fd 1 \
  dash_0.5.12-12.dsc > "$build_root/dash-source-signature.status"
grep -q '^\[GNUPG:\] VALIDSIG 83DCD17F44B22CC83656EDA1E8446B4AC8C77261 ' "$build_root/dash-source-signature.status"
dpkg-source -x "$source_dir/dash_0.5.12-12.dsc" "$build_root/source"

node --input-type=module - "$build_root/source" <<'REBUILD'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const source = process.argv[2];
const rulesPath = join(source, 'debian/rules');
const rules = readFileSync(rulesPath, 'utf8');
if ((rules.match(/--disable-fnmatch/g) ?? []).length !== 1 ||
    !rules.includes('--disable-glob') || !rules.includes('--disable-lineno'))
  throw Error('Unexpected maintained Dash build configuration');
writeFileSync(rulesPath, rules.replace('--disable-fnmatch', '--enable-fnmatch'));
const changelog = join(source, 'debian/changelog');
const old = readFileSync(changelog, 'utf8');
if (!old.startsWith('dash (0.5.12-12) ')) throw Error('Unexpected Dash source version');
writeFileSync(changelog, `dash (0.5.12-12+vaettir1) trixie; urgency=medium

  * Local runtime rebuild: use libc fnmatch instead of the recursive internal
    matcher affected by CVE-2026-102473. Retain all maintained Debian patches
    and the existing disable-glob and disable-lineno configuration.

 -- Vaettir Runtime Build <runtime-build@skaldandstone.com>  Fri, 02 Oct 2026 00:00:00 +0000

${old}`);
REBUILD
cd "$build_root/source"
timeout 600 env DEB_BUILD_OPTIONS=parallel=2 dpkg-buildpackage -b -us -uc
artifact="$build_root/dash_0.5.12-12+vaettir1_amd64.deb"
test "$(dpkg-deb -f "$artifact" Package)" = dash
test "$(dpkg-deb -f "$artifact" Version)" = '0.5.12-12+vaettir1'
dpkg-deb -x "$artifact" "$build_root/runtime"
binary="$build_root/runtime/usr/bin/dash"
if test ! -f "$binary"; then binary="$build_root/runtime/bin/dash"; fi
test -f "$binary"
timeout 30 node "$checker" "$binary" > "$build_root/dash-runtime-proof.txt"
cat "$build_root/dash-runtime-proof.txt"
printf '%s\n' 'Dash signed-source rebuild and libc matcher runtime verified'
