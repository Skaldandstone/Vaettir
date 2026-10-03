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
native_jobs=$(node /build/scripts/native-build-concurrency.mjs)
printf 'LLVM bounded compiler jobs: %s\n' "$native_jobs"
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
  -DLLVM_ENABLE_ASSERTIONS=ON -DLLVM_ABI_BREAKING_CHECKS=FORCE_OFF \
  -DLLVM_ENABLE_FFI=ON -DLLVM_ENABLE_LIBEDIT=ON -DLLVM_ENABLE_Z3_SOLVER=ON \
  -DLLVM_ENABLE_LIBPFM=ON \
  -DLLVM_ENABLE_ZLIB=FORCE_ON -DLLVM_ENABLE_ZSTD=FORCE_ON \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_BUILD_LLVM_DYLIB=ON -DLLVM_LINK_LLVM_DYLIB=ON \
  -DLLVM_DYLIB_COMPONENTS=all -DLLVM_PARALLEL_LINK_JOBS=1 -DLLVM_PARALLEL_COMPILE_JOBS="$native_jobs" \
  -DLLVM_USE_LINKER=gold \
  -DLLVM_INCLUDE_TESTS=ON -DLLVM_BUILD_TESTS=ON
# Check the generated configuration, not merely the requested CMake argument.
# ENABLE_ABI_BREAKING_CHECKS is the output macro, not the input option name.
grep -Fx 'LLVM_ABI_BREAKING_CHECKS:STRING=FORCE_OFF' /build/llvm-build/CMakeCache.txt
grep -Fx '#define LLVM_ENABLE_ABI_BREAKING_CHECKS 0' /build/llvm-build/include/llvm/Config/abi-breaking.h
# Establish the preserved distro ARM policy against the installed authenticated
# baseline BEFORE reconciling its one stale upstream unit fixture. No parser or
# production policy is changed; all original assertions and unit gates remain.
clang++-19 -std=c++17 -O2 -Wall -Wextra -Werror \
  -I/build/llvm-build/include -I/build/llvm-source/llvm/include \
  /build/scripts/check-llvm-arm-defaults.cpp /usr/lib/x86_64-linux-gnu/libLLVM.so.19.1 \
  -Wl,-z,relro,-z,now -o /build/llvm-arm-policy
readelf -d /build/llvm-arm-policy > /build/llvm-arm-policy-dynamic.txt
grep -F 'Shared library: [libLLVM.so.19.1]' /build/llvm-arm-policy-dynamic.txt
! grep -E 'RPATH|RUNPATH' /build/llvm-arm-policy-dynamic.txt
timeout 10 /build/llvm-arm-policy > /build/llvm-arm-baseline.txt
node /build/scripts/reconcile-llvm-arm-unit-fixture.mjs --signed-debian-image-build
# Resource-aware compiler concurrency remains bounded independently from link
# concurrency. All targets and unit checks stay fail-hard within their deadlines.
timeout 7200 cmake --build /build/llvm-build --parallel "$native_jobs" --target LLVM llvm-config
timeout 1800 cmake --build /build/llvm-build --parallel "$native_jobs" --target check-llvm-unit
timeout 10 /lib64/ld-linux-x86-64.so.2 --library-path /build/llvm-build/lib /build/llvm-arm-policy > /build/llvm-arm-candidate.txt
cmp /build/llvm-arm-baseline.txt /build/llvm-arm-candidate.txt
printf '%s\n' 'Independent LLVM ARM parser policy preserved: 33 baseline/candidate vectors; all unit assertions retained'
test "$(/build/llvm-build/bin/llvm-config --version)" = '19.1.7'
node /build/scripts/check-llvm-package.mjs \
  /usr/lib/x86_64-linux-gnu/libLLVM.so.19.1 \
  /build/llvm-build/lib/libLLVM.so.19.1 /build/llvm-abi.json

# Author-created fixed-input CPU codegen probe. No builder RPATH may hide a
# runtime dependency problem; run first with Debian's baseline shared library.
clang-19 -std=c11 -O2 -Wall -Wextra -Werror \
  -I/build/llvm-build/include -I/build/llvm-source/llvm/include \
  /build/scripts/check-llvm-jit.c /build/llvm-build/lib/libLLVM.so.19.1 \
  -Wl,-z,relro,-z,now -o /build/llvm-cpu-jit
readelf -d /build/llvm-cpu-jit > /build/llvm-cpu-jit-dynamic.txt
grep -F 'Shared library: [libLLVM.so.19.1]' /build/llvm-cpu-jit-dynamic.txt
! grep -E 'RPATH|RUNPATH' /build/llvm-cpu-jit-dynamic.txt
timeout 10 /build/llvm-cpu-jit

# Produce a real libllvm19 package with recalculated actual shared dependencies.
# Retain upstream package metadata/docs/license; annotate our local revision.
root=/build/llvm-source/debian/libllvm19
install -d "$root/DEBIAN" "$root/usr/lib/x86_64-linux-gnu" "$root/usr/share/doc/libllvm19" "$root/usr/share/vaettir"
install -m644 /build/llvm-build/lib/libLLVM.so.19.1 "$root/usr/lib/x86_64-linux-gnu/"
ln -s libLLVM.so.19.1 "$root/usr/lib/x86_64-linux-gnu/libLLVM-19.so"
cp -a /usr/share/doc/libllvm19/. "$root/usr/share/doc/libllvm19/"
cp /build/llvm-abi.json "$root/usr/share/vaettir/llvm-unstripped-abi.json"
cp /build/llvm-sources/source-manifest.json "$root/usr/share/vaettir/llvm-source-manifest.json"
cp /build/llvm-arm-baseline.txt "$root/usr/share/vaettir/llvm-arm-policy-baseline.txt"
cp /build/llvm-arm-unit-fixture-proof.json "$root/usr/share/vaettir/llvm-arm-unit-fixture-proof.json"
install -m755 /build/llvm-arm-policy "$root/usr/share/vaettir/llvm-arm-policy"
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
