#!/bin/sh
set -eu
build=${1:?Supply the tested glibc build directory}
case "$build" in /|*'/../'*|*'/./'*) exit 1 ;; /*) : ;; *) exit 1 ;; esac
libraries="$build/libc6/usr/lib/x86_64-linux-gnu"
binaries="$build/libc-bin/usr"
cp -a "$build/install/usr/lib/x86_64-linux-gnu/gconv" "$libraries/"
mkdir -p "$build/libc6/usr/lib64" "$binaries/sbin"
# GNU's runtime install paths differ from Debian's merged-/usr layout.
# Keep Debian-owned paths present throughout the in-image dpkg upgrade.
for library in "$build/install/lib64/"*.so*; do
  name=$(basename "$library")
  cp -a "$library" "$libraries/$name"
  ln -s "../lib/x86_64-linux-gnu/$name" "$build/libc6/usr/lib64/$name"
done
cp -a "$build/install/sbin/ldconfig" "$binaries/sbin/"
if test -d "$build/install/usr/libexec/getconf"; then
  mkdir -p "$binaries/libexec"
  cp -a "$build/install/usr/libexec/getconf" "$binaries/libexec/"
fi
if test -d "$build/install/usr/lib/x86_64-linux-gnu/audit"; then
  cp -a "$build/install/usr/lib/x86_64-linux-gnu/audit" "$libraries/"
fi
loader="$libraries/ld-linux-x86-64.so.2"
test ! -L "$loader"
"$loader" --library-path "$libraries" /bin/true
"$loader" --library-path "$libraries" "$binaries/bin/getconf" GNU_LIBC_VERSION | grep -Fx 'glibc 2.43'
"$binaries/sbin/ldconfig" --version > /dev/null
for package in libc6 libc-bin; do
  dpkg-deb --root-owner-group --build "$build/$package" "$build/${package}_2.43-7+vaettir1_amd64.deb"
done
