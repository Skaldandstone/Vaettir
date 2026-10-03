#!/bin/sh
# Isolated signed Debian source rebuild. No prebuilt library rewriting or aliases.
set -eu
test "$(dpkg --print-architecture)" = amd64
test "$(dpkg-query -W -f='${Version}' libllvm19)" = '1:19.1.7-3+b1'
test "$(dpkg-query -W -f='${Version}' clang-19)" = '1:19.1.7-3+b1'
cd /build/llvm-sources
gpgv --keyring /usr/share/keyrings/debian-keyring.gpg llvm-toolchain-19_19.1.7-3.dsc
dpkg-source -x llvm-toolchain-19_19.1.7-3.dsc /build/llvm-source
# dpkg-source applies the complete maintained quilt series, including SONAME.
cd /build/llvm-source
test "$(dpkg-parsechangelog -S Version)" = '1:19.1.7-3'
export DEB_BUILD_MAINT_OPTIONS='hardening=+all optimize=-lto'
export DEB_CFLAGS_MAINT_STRIP='-g -O2'
export DEB_CXXFLAGS_MAINT_STRIP='-g -O2'
export DEB_CFLAGS_MAINT_APPEND='-O2 -g1'
export DEB_CXXFLAGS_MAINT_APPEND='-O2 -g1'
cmake -S llvm -B /build/llvm-build -G Ninja \
  -DCMAKE_C_COMPILER=clang-19 -DCMAKE_CXX_COMPILER=clang++-19 \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/lib/llvm-19 \
  -DCMAKE_C_FLAGS="$(dpkg-buildflags --get CFLAGS) $(dpkg-buildflags --get CPPFLAGS)" \
  -DCMAKE_CXX_FLAGS="$(dpkg-buildflags --get CXXFLAGS) $(dpkg-buildflags --get CPPFLAGS)" \
  -DCMAKE_SHARED_LINKER_FLAGS="$(dpkg-buildflags --get LDFLAGS)" \
  -DLLVM_VERSION_SUFFIX= -DLLVM_TARGETS_TO_BUILD=all \
  '-DLLVM_EXPERIMENTAL_TARGETS_TO_BUILD=M68k;Xtensa' \
  -DLLVM_ENABLE_PROJECTS=polly -DLLVM_POLLY_LINK_INTO_TOOLS=ON \
  -DLLVM_ENABLE_RTTI=ON -DLLVM_ENABLE_DUMP=ON \
  -DLLVM_ENABLE_ASSERTIONS=ON -DLLVM_ENABLE_ABI_BREAKING_CHECKS=FORCE_OFF \
  -DLLVM_ENABLE_FFI=ON -DLLVM_ENABLE_LIBEDIT=ON -DLLVM_ENABLE_Z3_SOLVER=ON \
  -DLLVM_ENABLE_LIBPFM=ON \
  -DLLVM_ENABLE_ZLIB=FORCE_ON -DLLVM_ENABLE_ZSTD=FORCE_ON \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_BUILD_LLVM_DYLIB=ON -DLLVM_LINK_LLVM_DYLIB=ON \
  -DLLVM_DYLIB_COMPONENTS=all -DLLVM_PARALLEL_LINK_JOBS=1 \
  -DLLVM_USE_LINKER=gold \
  -DLLVM_INCLUDE_TESTS=ON -DLLVM_BUILD_TESTS=ON
timeout 5400 cmake --build /build/llvm-build --parallel 2 --target LLVM llvm-config
timeout 1800 cmake --build /build/llvm-build --parallel 2 --target check-llvm-unit
test "$(/build/llvm-build/bin/llvm-config --version)" = '19.1.7'
node /build/scripts/check-llvm-package.mjs \
  /usr/lib/x86_64-linux-gnu/libLLVM.so.19.1 \
  /build/llvm-build/lib/libLLVM.so.19.1 /build/llvm-abi.json

# Produce a real libllvm19 package with recalculated actual shared dependencies.
# Retain upstream package metadata/docs/license; annotate our local revision.
root=/build/llvm-source/debian/libllvm19
install -d "$root/DEBIAN" "$root/usr/lib/x86_64-linux-gnu" "$root/usr/share/doc/libllvm19" "$root/usr/share/vaettir"
install -m644 /build/llvm-build/lib/libLLVM.so.19.1 "$root/usr/lib/x86_64-linux-gnu/"
ln -s libLLVM.so.19.1 "$root/usr/lib/x86_64-linux-gnu/libLLVM-19.so"
cp -a /usr/share/doc/libllvm19/. "$root/usr/share/doc/libllvm19/"
cp /build/llvm-abi.json "$root/usr/share/vaettir/llvm-unstripped-abi.json"
cp /build/llvm-sources/source-manifest.json "$root/usr/share/vaettir/llvm-source-manifest.json"
strip --strip-unneeded "$root/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1"
node /build/scripts/check-llvm-package.mjs \
  /usr/lib/x86_64-linux-gnu/libLLVM.so.19.1 \
  "$root/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1" /build/llvm-stripped-abi.json
cp /build/llvm-stripped-abi.json "$root/usr/share/vaettir/llvm-abi.json"
dpkg-shlibdeps -O "$root/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1" > debian/libllvm19.substvars
dpkg-gencontrol -plibllvm19 -v'1:19.1.7-3+vaettir1' -P"$root" -O"$root/DEBIAN/control"
! grep -q 'libxml' "$root/DEBIAN/control"
printf '%s\n' 'libLLVM 19.1 libllvm19 (>= 1:19.1.7-3+vaettir1)' > "$root/DEBIAN/shlibs"
printf '%s\n' 'activate-noawait ldconfig' > "$root/DEBIAN/triggers"
dpkg-deb --root-owner-group --build "$root" /build/libllvm19_19.1.7-3+vaettir1_amd64.deb
test "$(dpkg-deb -f /build/libllvm19_19.1.7-3+vaettir1_amd64.deb Source)" = 'llvm-toolchain-19 (1:19.1.7-3)'
