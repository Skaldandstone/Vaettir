#!/bin/sh
# Isolated signed Debian source rebuild. No prebuilt library rewriting or aliases.
set -eu
build_mode=complete
case "$#" in
  0) ;;
  1)
    if test "$1" = '--configure-only'; then
      build_mode=configure-only
    elif test "$1" = '--release-core-only'; then
      build_mode=release-core-only
    else
      printf '%s\n' 'Unsupported LLVM build mode' >&2
      exit 64
    fi
    ;;
  *)
    printf '%s\n' 'Unsupported LLVM build arguments' >&2
    exit 64
    ;;
esac
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
measurement_started=$(date +%s)
printf 'LLVM bounded compiler jobs: %s\n' "$native_jobs"
configure_llvm() {
  build_dir=$1
  shift
  timeout 180 cmake -S llvm -B "$build_dir" -G Ninja \
  -DCMAKE_C_COMPILER=clang-19 -DCMAKE_CXX_COMPILER=clang++-19 \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_INSTALL_PREFIX=/usr/lib/llvm-19 \
  -DCMAKE_C_FLAGS_RELWITHDEBINFO='-O2 -DNDEBUG -g1' \
  -DCMAKE_CXX_FLAGS_RELWITHDEBINFO='-O2 -DNDEBUG -g1' \
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
  -DCMAKE_C_FLAGS="$(dpkg-buildflags --get CFLAGS) $(dpkg-buildflags --get CPPFLAGS)" \
  -DCMAKE_CXX_FLAGS="$(dpkg-buildflags --get CXXFLAGS) $(dpkg-buildflags --get CPPFLAGS)" \
  -DCMAKE_SHARED_LINKER_FLAGS="$(dpkg-buildflags --get LDFLAGS)" \
  -DLLVM_VERSION_SUFFIX= -DLLVM_TARGETS_TO_BUILD=all \
  '-DLLVM_EXPERIMENTAL_TARGETS_TO_BUILD=M68k;Xtensa' \
  -DLLVM_ENABLE_PROJECTS=polly -DLLVM_POLLY_LINK_INTO_TOOLS=ON \
  -DLLVM_ENABLE_RTTI=ON -DLLVM_ENABLE_DUMP=ON \
  -DLLVM_ABI_BREAKING_CHECKS=FORCE_OFF \
  -DLLVM_ENABLE_FFI=ON -DLLVM_ENABLE_LIBEDIT=ON -DLLVM_ENABLE_Z3_SOLVER=ON \
  -DLLVM_ENABLE_LIBPFM=ON -DLLVM_USE_PERF=ON \
  -DLLVM_ENABLE_ZLIB=FORCE_ON -DLLVM_ENABLE_ZSTD=FORCE_ON \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_DYLIB_COMPONENTS=all -DLLVM_PARALLEL_LINK_JOBS=1 -DLLVM_PARALLEL_COMPILE_JOBS="$native_jobs" \
  -DLLVM_USE_LINKER=gold \
  -DLLVM_INCLUDE_TESTS=ON -DLLVM_BUILD_TESTS=ON "$@"
}
# NDEBUG controls public class/vtable layout separately from ABI-breaking checks.
# Match Debian's normal amd64 release policy; never link assertion-on objects
# into this DSO. The independent assertion-enabled full unit build is mandatory.
configure_llvm /build/llvm-build \
  -DLLVM_ENABLE_ASSERTIONS=OFF \
  -DLLVM_BUILD_LLVM_DYLIB=ON -DLLVM_LINK_LLVM_DYLIB=ON
configure_llvm /build/llvm-assert-build \
  -DLLVM_ENABLE_ASSERTIONS=ON \
  -DLLVM_BUILD_LLVM_DYLIB=OFF -DLLVM_LINK_LLVM_DYLIB=OFF
# Check the generated configuration, not merely the requested CMake argument.
# ENABLE_ABI_BREAKING_CHECKS is the output macro, not the input option name.
verify_llvm_configuration() {
  variant=$1
  build_dir=$2
  assertions=$3
  dylib=$4
  grep -Fx 'CMAKE_BUILD_TYPE:STRING=RelWithDebInfo' "$build_dir/CMakeCache.txt"
  grep -Fx 'CMAKE_C_FLAGS_RELWITHDEBINFO:STRING=-O2 -DNDEBUG -g1' "$build_dir/CMakeCache.txt"
  grep -Fx 'CMAKE_CXX_FLAGS_RELWITHDEBINFO:STRING=-O2 -DNDEBUG -g1' "$build_dir/CMakeCache.txt"
  grep -Fx "LLVM_ENABLE_ASSERTIONS:BOOL=$assertions" "$build_dir/CMakeCache.txt"
  grep -Fx "LLVM_BUILD_LLVM_DYLIB:BOOL=$dylib" "$build_dir/CMakeCache.txt"
  grep -Fx "LLVM_LINK_LLVM_DYLIB:BOOL=$dylib" "$build_dir/CMakeCache.txt"
  grep -Fx 'LLVM_USE_PERF:BOOL=ON' "$build_dir/CMakeCache.txt"
  grep -Fx '#define LLVM_USE_PERF 1' "$build_dir/include/llvm/Config/llvm-config.h"
  grep -Fx 'LLVM_ABI_BREAKING_CHECKS:STRING=FORCE_OFF' "$build_dir/CMakeCache.txt"
  grep -Fx '#define LLVM_ENABLE_ABI_BREAKING_CHECKS 0' "$build_dir/include/llvm/Config/abi-breaking.h"
  timeout 30 node - "$variant" "$build_dir" "$assertions" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const [variant, directory, assertions] = process.argv.slice(2);
const path = directory + '/compile_commands.json';
assert.ok(fs.statSync(path).size <= 64 * 1024 * 1024, 'Bounded generated commands required');
const commands = JSON.parse(fs.readFileSync(path, 'utf8'));
assert.ok(Array.isArray(commands));
// Inspect actual compiler commands for library and unit translation units,
// including effective final NDEBUG state, not only requested cache options.
const relevant = commands.filter(entry => /^\/build\/llvm-source\/llvm\/(lib|unittests)\/.+\.(c|cc|cpp|cxx)$/.test(entry.file));
assert.ok(relevant.filter(entry => entry.file.includes('/llvm/lib/')).length >= 100);
assert.ok(relevant.filter(entry => entry.file.includes('/llvm/unittests/')).length >= 10);
// Debian enables this real component. Omitting its TU also omitted legitimate
// exported template definitions; never substitute aliases or relaxed ABI checks.
assert.equal(relevant.filter(entry => entry.file === '/build/llvm-source/llvm/lib/ExecutionEngine/PerfJITEvents/PerfJITEventListener.cpp').length, 1, 'Maintained PERF JIT translation unit required');
for (const entry of relevant) {
  assert.equal(typeof entry.command, 'string');
  const flags = entry.command.split(/\s+/);
  assert.ok(flags.includes('-O2') && flags.includes('-g1'), 'Maintained optimization/debug flags required');
  assert.ok(!flags.some(flag => /^-O(?:0|1|3|s|z|fast)$/.test(flag)), 'Unexpected optimization policy');
  const ndebug = flags.filter(flag => /^-[DU]NDEBUG(?:=\S+)?$/.test(flag));
  assert.equal(ndebug.at(-1), assertions === 'ON' ? '-UNDEBUG' : '-DNDEBUG', 'Effective NDEBUG policy mismatch');
  if (assertions === 'OFF') assert.ok(!flags.includes('-UNDEBUG'), 'Release ABI must not include assertion-on objects');
}
const receipt = { variant, buildType: 'RelWithDebInfo', assertions, sharedDylib: assertions === 'OFF', abiBreakingChecks: false, perfJitComponent: true, verifiedTranslationUnits: relevant.length, flags: '-O2 -DNDEBUG -g1', effectiveNdebug: assertions === 'ON' ? 'undefined' : 'defined' };
fs.writeFileSync('/build/llvm-' + variant + '-configuration.json', JSON.stringify(receipt) + '\n');
console.log('Verified LLVM generated configuration: ' + JSON.stringify(receipt));
NODE
}
verify_llvm_configuration release /build/llvm-build OFF ON
verify_llvm_configuration assertions /build/llvm-assert-build ON OFF
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
# Measure both complete dependency graphs before any expensive LLVM compile.
# A dry run is scheduling evidence, not test or runtime acceptance. Keep the
# existing job/deadline limits even when the second independent build is large.
timeout 60 ninja -C /build/llvm-build -n LLVM llvm-config check-llvm-unit > /build/llvm-release-dry-run.txt
timeout 60 ninja -C /build/llvm-assert-build -n check-llvm-unit > /build/llvm-assertions-dry-run.txt
timeout 30 node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const graphs = {};
for (const variant of ['release', 'assertions']) {
  const path = '/build/llvm-' + variant + '-dry-run.txt';
  assert.ok(fs.statSync(path).size <= 32 * 1024 * 1024, 'Bounded Ninja graph required');
  const lines = fs.readFileSync(path, 'utf8').split('\n');
  const steps = lines.filter(line => /^\[\d+\/\d+\] /.test(line));
  assert.ok(steps.length >= 100, 'Full dependency graph unexpectedly empty');
  graphs[variant] = { scheduledCommands: steps.length, compilationCommands: steps.filter(line => /Building (C|CXX) object/.test(line)).length, acceptance: false };
  assert.ok(graphs[variant].compilationCommands >= 100, 'Compiler graph unexpectedly incomplete');
}
fs.writeFileSync('/build/llvm-build-graphs.json', JSON.stringify(graphs) + '\n');
console.log('Bounded LLVM dry-run dependency graphs (not acceptance): ' + JSON.stringify(graphs));
NODE
# This bounded receipt measures only configuration/scheduling/storage. It cannot
# certify any compiled unit, candidate DSO, package, runtime or deployment.
timeout 30 node - "$build_mode" "$native_jobs" "$measurement_started" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const [mode, jobs, started] = process.argv.slice(2);
assert.ok(['complete', 'configure-only', 'release-core-only'].includes(mode));
assert.ok(/^\d+$/.test(jobs) && Number(jobs) >= 1 && Number(jobs) <= 24);
assert.ok(/^\d+$/.test(started));
const hash = (path, bound) => {
  assert.ok(fs.statSync(path).size <= bound, 'Bounded measurement input required');
  return createHash('sha256').update(fs.readFileSync(path)).digest('hex');
};
const paths = ['/build/llvm-source', '/build/llvm-build', '/build/llvm-assert-build'];
const usage = spawnSync('/usr/bin/du', ['-sk', '--', ...paths], { timeout: 10000, maxBuffer: 4096, encoding: 'utf8', env: { LC_ALL: 'C' } });
assert.ifError(usage.error);
assert.equal(usage.status, 0, 'Storage measurement failed');
const usageLines = usage.stdout.trimEnd().split('\n');
assert.equal(usageLines.length, paths.length);
const directoryKiB = {};
usageLines.forEach((line, index) => {
  const fields = line.split('\t');
  assert.equal(fields.length, 2);
  assert.ok(/^\d+$/.test(fields[0]));
  assert.equal(fields[1], paths[index]);
  directoryKiB[paths[index]] = fields[0];
});
const disk = fs.statfsSync('/build', { bigint: true });
assert.ok(fs.statSync('/build/llvm-build-graphs.json').size <= 16384);
const receipt = {
  schemaVersion: 1,
  purpose: 'llvm-configure-only-measurement',
  mode,
  elapsedSeconds: Math.floor(Date.now() / 1000) - Number(started),
  boundedCompilerJobs: Number(jobs),
  availableParallelism: os.availableParallelism(),
  effectiveMemoryBytes: Math.min(os.totalmem(), process.constrainedMemory() || os.totalmem()),
  diskAvailableBytes: String(disk.bavail * disk.bsize),
  diskTotalBytes: String(disk.blocks * disk.bsize),
  directoryKiB,
  sourceManifestSha256: hash('/build/llvm-sources/source-manifest.json', 65536),
  recipeSha256: hash('/build/scripts/build-llvm-runtime.sh', 65536),
  releaseCacheSha256: hash('/build/llvm-build/CMakeCache.txt', 1024 * 1024),
  assertionsCacheSha256: hash('/build/llvm-assert-build/CMakeCache.txt', 1024 * 1024),
  graphs: JSON.parse(fs.readFileSync('/build/llvm-build-graphs.json', 'utf8')),
  compileAcceptance: false,
  unitAcceptance: false,
  candidateAbiAcceptance: false,
  packageCreated: false,
  runtimeAcceptance: false,
  authenticatedAcceptance: false,
};
assert.ok(Number.isSafeInteger(receipt.elapsedSeconds) && receipt.elapsedSeconds >= 0);
const serialized = JSON.stringify(receipt);
assert.ok(Buffer.byteLength(serialized) <= 8192, 'Bounded diagnostic receipt required');
fs.writeFileSync('/build/llvm-configure-only-measurement.json', serialized + '\n');
console.log('LLVM_CONFIGURE_ONLY_MEASUREMENT=' + serialized);
NODE
if test "$build_mode" = configure-only; then
  printf '%s\n' 'LLVM configure-only diagnostic complete; no LLVM target compilation, unit acceptance or package'
  exit 0
fi
# Resource-aware compiler concurrency remains bounded independently from link
# concurrency. All targets and unit checks stay fail-hard within their deadlines.
timeout 7200 cmake --build /build/llvm-build --parallel "$native_jobs" --target LLVM llvm-config
# Reject the known release blocker before compiling either complete unit graph.
# This is an additional fail-hard check, not unit or package acceptance; repeat
# compatibility after both suites and again on the final stripped package below.
node /build/scripts/check-llvm-package.mjs \
  /usr/lib/x86_64-linux-gnu/libLLVM.so.19.1 \
  /build/llvm-build/lib/libLLVM.so.19.1 /build/llvm-early-abi.json
# Explicit non-runtime diagnosis of the actual core/strict ABI, within the
# observed build deadline. No package or complete-unit acceptance follows.
if test "$build_mode" = release-core-only; then
  timeout 30 node - "$measurement_started" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const hash = (path) => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const path = '/build/llvm-early-abi.json';
assert.ok(fs.statSync(path).size <= 65536, 'Bounded strict ABI receipt required');
const receipt = {
  schemaVersion: 1,
  purpose: 'llvm-release-core-only',
  recipeSha256: hash('/build/scripts/build-llvm-runtime.sh'),
  sourceManifestSha256: hash('/build/llvm-sources/source-manifest.json'),
  releaseCacheSha256: hash('/build/llvm-build/CMakeCache.txt'),
  baselineSha256: hash('/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1'),
  candidateSha256: hash('/build/llvm-build/lib/libLLVM.so.19.1'),
  elapsedSeconds: Math.floor(Date.now() / 1000) - Number(process.argv[2]),
  strictAbi: JSON.parse(fs.readFileSync(path, 'utf8')),
  releaseCoreCompiled: true,
  earlyAbiAcceptance: true,
  unitAcceptance: false,
  packageCreated: false,
  runtimeAcceptance: false,
  authenticatedAcceptance: false,
  deploymentAcceptance: false,
};
assert.ok(Number.isSafeInteger(receipt.elapsedSeconds) && receipt.elapsedSeconds >= 0);
const serialized = JSON.stringify(receipt);
assert.ok(Buffer.byteLength(serialized) <= 73728, 'Bounded diagnostic receipt required');
fs.writeFileSync('/build/llvm-release-core-only.json', serialized + '\n');
console.log('LLVM_RELEASE_CORE_ONLY=' + serialized);
NODE
  printf '%s\n' 'LLVM release-core diagnostic only; complete units, package, runtime and deployment NOT accepted'
  exit 0
fi

timeout 1800 cmake --build /build/llvm-build --parallel "$native_jobs" --target check-llvm-unit
# Static asserted objects/tests are confined to this separate directory. Running
# the complete asserted suite is compulsory, not a fallback for ABI failure.
timeout 7200 cmake --build /build/llvm-assert-build --parallel "$native_jobs" --target check-llvm-unit
timeout 10 /lib64/ld-linux-x86-64.so.2 --library-path /build/llvm-build/lib /build/llvm-arm-policy > /build/llvm-arm-candidate.txt
cmp /build/llvm-arm-baseline.txt /build/llvm-arm-candidate.txt
printf '%s\n' 'Independent LLVM ARM parser policy preserved: 33 baseline/candidate vectors; complete release and assertion-enabled unit suites passed'
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
cp /build/llvm-release-configuration.json /build/llvm-assertions-configuration.json /build/llvm-build-graphs.json "$root/usr/share/vaettir/"
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
