#!/bin/sh
# Build signed maintained native packages; final image acceptance is separate.
set -eu
manifest=${1:?Supply the exact reviewed security manifest}
glibc_sources=${2:?Supply the pinned glibc acquisition directory}
freetype_sources=${3:?Supply the pinned FreeType acquisition directory}
build_root=${4:?Supply a fresh isolated combined build root}
proof_script=${5:?Supply this candidate runtime-build-proof.mjs}
freetype_corpus=${6:?Supply the independently pinned maintained FreeType test corpus}
for path in "$manifest" "$glibc_sources" "$freetype_sources" "$build_root" "$proof_script" "$freetype_corpus"; do
  case "$path" in /build/*) : ;; *) echo 'Only explicit isolated /build paths are admitted' >&2; exit 1 ;; esac
done
test "$(id -u)" != 0
test "$(dpkg --print-architecture)" = amd64
test ! -e "$build_root"
mkdir "$build_root"
export LC_ALL=C LANG=C
native_jobs=${VAETTIR_NATIVE_JOBS:-2}
case "$native_jobs" in 2|4) : ;; *) echo 'Only bounded two/four-worker native builds are admitted' >&2; exit 1 ;; esac
test "$(getconf _NPROCESSORS_ONLN)" -ge "$native_jobs"
if test "$native_jobs" = 4; then
  test "$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)" -ge 8388608
  if test -f /sys/fs/cgroup/memory.max; then
    memory_limit=$(cat /sys/fs/cgroup/memory.max)
    if test "$memory_limit" != max; then test "$memory_limit" -ge 8589934592; fi
  fi
fi
# ONE combined clock, not separate 3500s budgets per component. The surrounding
# existing build still must complete inside its unchanged 60-minute deadline.
started=$(date +%s)
deadline=$((started + 3500))
run() {
  now=$(date +%s)
  remaining=$((deadline - now))
  test "$remaining" -gt 0
  timeout --signal=TERM --kill-after=10 "$remaining" "$@"
}
for component in glibc freetype; do
  case "$component" in
    glibc) sources=$glibc_sources; dsc=glibc_2.41-12+deb13u4.dsc; signer=52BC8695BE34F90AD7D40CB81388C0F899E8336B; profiles=nobiarch ;;
    freetype) sources=$freetype_sources; dsc=freetype_2.13.3+dfsg-1+deb13u1.dsc; signer=B6E62F3D12AC38495C0DA90510C293B6C37C4E36; profiles= ;;
  esac
  root="$build_root/$component"
  mkdir "$root"
  run node "$proof_script" pins "$manifest" "$component" "$sources"
  run gpgv --keyring /usr/share/keyrings/debian-keyring.gpg --keyring /usr/share/keyrings/debian-maintainers.gpg --status-fd 1 "$sources/$dsc" > "$root/$component-source-signature.status"
  grep -q "^\[GNUPG:\] VALIDSIG $signer " "$root/$component-source-signature.status"
  run node "$proof_script" signature "$component" "$manifest" "$root/$component-source-signature.status"
  run dpkg-source -x "$sources/$dsc" "$root/source" > "$root/extract.log" 2>&1
  run node "$proof_script" prepare "$component" "$manifest" "$sources" "$root/source" "$root"
  cd "$root/source"
  # dpkg-source applied Debian's maintained series during extraction. Require
  # each additional pinned official patch's exact context before quilt records
  # its actual application; never manufacture quilt state or use offset fuzz.
  node --input-type=module - "$manifest" "$component" <<'PATCH_NAMES' > "$root/official-patches.txt"
import {readFileSync} from 'node:fs';
const m=JSON.parse(readFileSync(process.argv[2],'utf8'));
for(const patch of m.components[process.argv[3]].patches)console.log('vaettir-official-'+patch.name);
PATCH_NAMES
  while IFS= read -r patch_name; do
    run patch --batch --fuzz=0 -p1 --dry-run < "debian/patches/$patch_name"
    run quilt push
  done < "$root/official-patches.txt"
  run dpkg-source --before-build .
  # No nocheck/stage1/stage2/dependency bypass. nobiarch selects the unchanged
  # native amd64 pass; the runtime has no i386 or x32 glibc installation.
  run env DEB_BUILD_PROFILES="$profiles" dpkg-checkbuilddeps
  if test "$component" = glibc; then
    # Remove ONLY the ten recorded XPASS expected-failure allowances. Empty
    # command-line make variables propagate to every submake; no test is skipped,
    # rewritten or weakened. Any future failure of these tests is now fatal.
    required_pass_flags=$(run node "$proof_script" required-pass-makeflags)
    run env MAKEFLAGS="$required_pass_flags" DEB_BUILD_OPTIONS="parallel=$native_jobs" DEB_BUILD_PROFILES="$profiles" dpkg-buildpackage -b -us -uc > "$root/package-build.log" 2>&1
  else
    run env DEB_BUILD_OPTIONS="parallel=$native_jobs" DEB_BUILD_PROFILES="$profiles" dpkg-buildpackage -b -us -uc > "$root/package-build.log" 2>&1
  fi
  run dpkg-source --before-build .
  if test "$component" = glibc; then
    build_dir="$root/source/build-tree/amd64-libc"
    test -f "$build_dir/tests.sum"
    # Preserve the package phase's original ignored failures BEFORE a rerun.
    cp "$build_dir/tests.sum" "$root/package-tests.sum"
    run node "$proof_script" tests "$build_dir" "$root/package-tests-proof.json"
    # Exact maintained, complete native check; no subdirs/tests filter, no
    # cross-compilation, no stop-on-first-failure or new test exemptions.
    run env MAKEFLAGS="$required_pass_flags" LD_PRELOAD= LANG= LANGUAGE= make -C "$build_dir" -j"$native_jobs" check > "$root/upstream-check.log" 2>&1
    cp "$build_dir/tests.sum" "$root/upstream-tests.sum"
    run node "$proof_script" tests "$build_dir" "$root/upstream-tests-proof.json"
    run make -C "$build_dir" -j"$native_jobs" check-abi > "$root/upstream-abi.log" 2>&1
  else
    # Run the maintained complete standard suite from the SAME patched source,
    # using its exact independently pinned upstream corpus; no network wraps.
    run node "$proof_script" standard-corpus "$freetype_corpus" "$root/freetype-corpus-proof.json"
    test ! -e "$root/source/tests/data/As.I.Lay.Dying.ttf"
    mkdir -p "$root/source/tests/data"
    cp "$freetype_corpus/As.I.Lay.Dying.ttf" "$root/source/tests/data/As.I.Lay.Dying.ttf"
    run meson setup "$root/meson-tests" "$root/source" -Dtests=enabled -Dharfbuzz=disabled --wrap-mode=nodownload > "$root/meson-setup.log" 2>&1
    run meson compile -C "$root/meson-tests" -j"$native_jobs" > "$root/meson-compile.log" 2>&1
    run meson test -C "$root/meson-tests" --no-rebuild --print-errorlogs --num-processes "$native_jobs" > "$root/meson-test.log" 2>&1
    run node "$proof_script" freetype-standard-test "$root/meson-tests/meson-logs/testlog.json" "$root/freetype-standard-test-proof.json"
    printf '%s\n' 'FreeType maintained package/demos and complete standard tests passed; CID-targeted runtime acceptance NOT performed.' > "$root/freetype-acceptance-gap.txt"
  fi
  run node "$proof_script" packages "$component" "$root"
  # Stage package payloads only; do not install a new libc into this builder.
  # Installed final image must take the complete currently installed family
  # from the same inventory and pass the separate family/ELF receipt checker.
  mkdir "$root/runtime"
  for package in "$root"/*.deb; do
    case "$package" in *.deb) run dpkg-deb -x "$package" "$root/runtime" ;; esac
  done
  run node "$proof_script" elf-family "$component" "$root/runtime" "$root/$component-installed-elf-inventory.json"
done
printf '%s\n' 'Maintained package candidates prepared. Installed family/ABI/final image/CID/security gates remain required.'
