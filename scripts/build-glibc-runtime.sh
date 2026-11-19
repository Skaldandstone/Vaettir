#!/bin/sh
set -eu
sources=${1:?Supply the pinned source directory}
build=${2:?Supply a fresh build directory}
for path in "$sources" "$build"; do
  case "$path" in /|*'/../'*|*'/./'*) exit 1 ;; /*) : ;; *) exit 1 ;; esac
done
test ! -e "$build"
test "$(dpkg --print-architecture)" = amd64
mkdir -p "$build/checks"
diagnostics() {
  result=$?
  trap - 0
  if test "$result" -ne 0; then
    for log in configure build tests install; do
      if test -f "$build/checks/$log.log"; then tail -n 25 "$build/checks/$log.log"; fi
    done
  fi
  exit "$result"
}
trap diagnostics 0
cd "$sources"
sha256sum --check <<'PINS'
a99e5beb8f568765d191f3d0d074cf6b60d2c89dec84f2f4bb70573e52e0a835  glibc_2.43-7.dsc
b8f0d50a7d4255658efe1f608cacdc4be82bb3c009875626df5968cc64c58880  glibc_2.43.orig.tar.xz
9f62b90fb4c7423ed5023698c9014ad0086d26f9b6f46b2a163afcea7e581a02  glibc_2.43-7.debian.tar.xz
PINS
gpgv --keyring /usr/share/keyrings/debian-keyring.gpg --keyring /usr/share/keyrings/debian-maintainers.gpg --status-fd 1 glibc_2.43-7.dsc > "$build/checks/signature.status"
grep -q '^\[GNUPG:\] VALIDSIG 52BC8695BE34F90AD7D40CB81388C0F899E8336B ' "$build/checks/signature.status"
! grep -Eq '\[GNUPG:\] (BADSIG|ERRSIG|EXPSIG|EXPKEYSIG|REVKEYSIG|KEYEXPIRED|SIGEXPIRED)' "$build/checks/signature.status"
dpkg-source -x glibc_2.43-7.dsc "$build/source"
mkdir "$build/compile" "$build/install"
# glibc requires an out-of-tree build. Run its entire upstream suite as an
# ordinary user so privilege-dependent checks observe the shipped use case.
useradd --system --create-home glibc-build
chown -R glibc-build:glibc-build "$build"
su -s /bin/sh glibc-build -c "cd '$build/compile' && '../source/configure' --prefix=/usr --libdir=/usr/lib/x86_64-linux-gnu --enable-kernel=3.2 --enable-stack-protector=strong --enable-fortify-source=2 --disable-werror > '../checks/configure.log' 2>&1"
su -s /bin/sh glibc-build -c "cd '$build/compile' && timeout 2400 make -j12 > '../checks/build.log' 2>&1"
su -s /bin/sh glibc-build -c "cd '$build/compile' && timeout 2400 make -j12 check > '../checks/tests.log' 2>&1"
su -s /bin/sh glibc-build -c "cd '$build/compile' && timeout 180 make install DESTDIR='$build/install' > '../checks/install.log' 2>&1"
libc="$build/libc6"
bins="$build/libc-bin"
mkdir -p "$libc/usr/lib/x86_64-linux-gnu" "$libc/DEBIAN" "$bins/usr" "$bins/DEBIAN"
find "$build/install/usr/lib/x86_64-linux-gnu" -maxdepth 1 \( -type f -o -type l \) -name '*.so*' -exec cp -a '{}' "$libc/usr/lib/x86_64-linux-gnu/" \;
if test -d "$build/install/usr/lib64"; then cp -a "$build/install/usr/lib64" "$libc/usr/"; fi
for directory in bin sbin; do
  if test -d "$build/install/usr/$directory"; then cp -a "$build/install/usr/$directory" "$bins/usr/"; fi
done
cat > "$libc/DEBIAN/control" <<'LIBC'
Package: libc6
Source: glibc (2.43-7)
Version: 2.43-7+vaettir1
Architecture: amd64
Maintainer: Vaettir Runtime Build <runtime-build@skaldandstone.com>
Depends: libgcc-s1
Description: GNU C library built from signed Debian security source
 Full upstream test results and corresponding source are retained.
LIBC
cat > "$bins/DEBIAN/control" <<'BINS'
Package: libc-bin
Source: glibc (2.43-7)
Version: 2.43-7+vaettir1
Architecture: amd64
Maintainer: Vaettir Runtime Build <runtime-build@skaldandstone.com>
Depends: libc6 (= 2.43-7+vaettir1)
Description: GNU C library runtime utilities from the matching source build
BINS
proof="$libc/usr/share/vaettir/glibc-security"
mkdir -p "$proof/source"
cp "$sources"/glibc_* "$sources/source-manifest.json" "$build/source/COPYING.LIB" "$proof/source/"
cp "$build/checks/signature.status" "$build/checks/tests.log" "$build/compile/tests.sum" "$proof/"
cp "$0" "$proof/"
for package in libc6 libc-bin; do
  dpkg-deb --root-owner-group --build "$build/$package" "$build/${package}_2.43-7+vaettir1_amd64.deb"
done
