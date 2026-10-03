import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  verifyLlvmCompatibility,
  exportedSymbols,
} from "./check-llvm-package.mjs";

const baseline = {
  soname: "libLLVM.so.19.1",
  needed: ["libxml2.so.2", "libffi.so.8", "libstdc++.so.6"],
  symbols: "LLVMVersion@@LLVM_19.1 T 123 12\nLLVMGlobal@@LLVM_19.1 D 321 8\n",
};
const candidate = {
  ...baseline,
  needed: ["libffi.so.8", "libstdc++.so.6"],
  symbols: "LLVMVersion@@LLVM_19.1 T 456 18\nLLVMGlobal@@LLVM_19.1 D 789 8\n",
};
test("LLVM mode preflight accepts only explicit diagnostic modes or complete before system access", () => {
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  );
  const boundary = 'test "$(dpkg --print-architecture)" = amd64';
  assert.equal(script.split(boundary).length, 2);
  // Execute the real argument parser alone, before any dpkg, source or network
  // command. This synthetic parser test does not claim a Linux build ran.
  const parser =
    script.slice(0, script.indexOf(boundary)).replaceAll("\r\n", "\n") +
    '\nprintf "%s\\n" "$build_mode"\n';
  const shell =
    process.platform === "win32"
      ? "C:/Program Files/Git/bin/bash.exe"
      : "/bin/sh";
  for (const [args, expected] of [
    [[], "complete"],
    [["--configure-only"], "configure-only"],
    [["--release-core-only"], "release-core-only"],
  ]) {
    const result = spawnSync(
      shell,
      ["-c", parser, "llvm-mode-fixture", ...args],
      { timeout: 5000, maxBuffer: 4096, encoding: "utf8", env: {} },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected + "\n");
  }
  for (const args of [
    ["--skip-units"],
    ["--configure-only=yes"],
    ["configure-only"],
    ["--configure-only", "extra"],
    ["--configure-only", "--configure-only"],
    ["--release-core-only=1"],
    ["--release-core-only", "--configure-only"],
    [""],
  ]) {
    const result = spawnSync(
      shell,
      ["-c", parser, "llvm-mode-fixture", ...args],
      { timeout: 5000, maxBuffer: 4096, encoding: "utf8", env: {} },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 64);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Unsupported LLVM build/);
  }
});
test("configure-only measures both real policies and graphs but cannot feed runtime packaging", () => {
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const stop = script.indexOf('if test "$build_mode" = configure-only; then');
  assert.ok(stop > 0);
  for (const required of [
    "verify_llvm_configuration release",
    "verify_llvm_configuration assertions",
    "reconcile-llvm-arm-unit-fixture.mjs --signed-debian-image-build",
    "timeout 60 ninja -C /build/llvm-build -n",
    "timeout 60 ninja -C /build/llvm-assert-build -n",
    "LLVM_CONFIGURE_ONLY_MEASUREMENT=",
  ])
    assert.ok(
      script.indexOf(required) >= 0 && script.indexOf(required) < stop,
      required,
    );
  assert.match(
    script.slice(stop),
    /^if test "\$build_mode" = configure-only; then\n\s+printf [^\n]+\n\s+exit 0\nfi/,
  );
  for (const gate of [
    "timeout 7200 cmake --build /build/llvm-build",
    "timeout 1800 cmake --build /build/llvm-build",
    "timeout 7200 cmake --build /build/llvm-assert-build",
    "cmp /build/llvm-arm-baseline.txt /build/llvm-arm-candidate.txt",
    "node /build/scripts/check-llvm-package.mjs",
    "dpkg-deb --root-owner-group --build",
  ])
    assert.ok(script.indexOf(gate) > stop, gate);
  assert.match(
    script,
    /timeout 30 node - "\$build_mode" "\$native_jobs" "\$measurement_started"/,
  );
  assert.match(
    script,
    /spawnSync\('\/usr\/bin\/du',[^\n]+timeout: 10000, maxBuffer: 4096/,
  );
  for (const field of [
    "compileAcceptance",
    "unitAcceptance",
    "candidateAbiAcceptance",
    "packageCreated",
    "runtimeAcceptance",
    "authenticatedAcceptance",
  ])
    assert.ok(script.includes(field + ": false"), field);
  const docker = readFileSync(
    new URL("../Dockerfile.api", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  assert.match(docker, /^FROM [^\n]+ AS llvm-build-inputs$/m);
  assert.match(
    docker,
    /^FROM llvm-build-inputs AS llvm-configure-only\nLABEL vaettir.artifact-purpose="llvm-configure-only" vaettir.runtime-eligible="false"\nRUN sh \/build\/scripts\/build-llvm-runtime.sh --configure-only$/m,
  );
  assert.match(
    docker,
    /^FROM llvm-build-inputs AS llvm-build\nRUN sh \/build\/scripts\/build-llvm-runtime.sh$/m,
  );
  assert.doesNotMatch(
    docker,
    /(?:COPY --from=|^FROM )llvm-configure-only(?:\s|$)/m,
  );
  assert.match(
    docker,
    /COPY --from=llvm-build \/build\/libllvm19_19.1.7-3\+vaettir1_amd64.deb/,
  );
});
test("LLVM package preserves exact SONAME, exports, object storage and remaining native dependencies", () => {
  assert.equal(verifyLlvmCompatibility(baseline, candidate).baselineExports, 2);
  for (const bad of [
    { ...candidate, soname: "libLLVM.so.21" },
    { ...candidate, symbols: "LLVMVersion@@LLVM_19.1 T 0 12" },
    { ...candidate, symbols: candidate.symbols.replace("D 789 8", "D 789 10") },
    {
      ...candidate,
      symbols: candidate.symbols.replace("LLVM_19.1", "LLVM_19.2"),
    },
    { ...candidate, needed: baseline.needed },
    { ...candidate, needed: ["libffi.so.8"] },
  ])
    assert.throws(
      () => verifyLlvmCompatibility(baseline, bad),
      /changed|still links|unexpectedly removed/,
    );
  assert.throws(() => exportedSymbols("x T 0 1\nx T 1 1"), /Duplicate/);
  assert.throws(() => exportedSymbols("malformed"), /Invalid/);
});
test("failed LLVM exports identify absent symbols versus binding or storage drift without accepting them", () => {
  for (const [symbols, expectedActual] of [
    ["LLVMGlobal@@LLVM_19.1 D 789 8\n", "null"],
    [candidate.symbols.replace(" T ", " W "), '{"type":"W"}'],
    [
      candidate.symbols.replace("D 789 8", "D 789 10"),
      '{"type":"D","size":"10"}',
    ],
  ]) {
    assert.throws(
      () => verifyLlvmCompatibility(baseline, { ...candidate, symbols }),
      (error) => {
        assert.match(error.message, /^LLVM exported ABI changed:/);
        assert.ok(error.message.includes("; expected="));
        assert.ok(error.message.endsWith("; actual=" + expectedActual));
        assert.equal(error.llvmAbiMismatch.baselineExports, 2);
        assert.equal(
          error.llvmAbiMismatch.candidateExports,
          expectedActual === "null" ? 1 : 2,
        );
        return true;
      },
    );
  }
  assert.equal(verifyLlvmCompatibility(baseline, candidate).baselineExports, 2);
});
test("ABI diagnostics retain complete drift counts with bounded samples and still reject", () => {
  const symbols = Array.from(
    { length: 40 },
    (_, index) => `Required${index} W 0 1`,
  ).join("\n");
  assert.throws(
    () =>
      verifyLlvmCompatibility(
        { ...baseline, symbols },
        { ...candidate, symbols: "Required0 T 0 1\nExtra W 0 1\n" },
      ),
    (error) => {
      assert.match(error.message, /^LLVM exported ABI changed: Required0;/);
      assert.equal(error.llvmAbiDifferences.missing, 39);
      assert.equal(error.llvmAbiDifferences.changed, 1);
      assert.equal(error.llvmAbiDifferences.extra, 1);
      assert.equal(error.llvmAbiDifferences.samples.length, 32);
      assert.equal(error.llvmAbiDifferences.truncated, true);
      assert.deepEqual(error.llvmAbiDifferences.samples[0], {
        symbol: "Required0",
        symbolTruncated: false,
        expected: { type: "W", size: undefined },
        actual: { type: "T", size: undefined },
      });
      return true;
    },
  );
  const longSymbol = "Required" + "x".repeat(2000);
  assert.throws(
    () =>
      verifyLlvmCompatibility(
        { ...baseline, symbols: `${longSymbol} W 0 1` },
        candidate,
      ),
    (error) => {
      assert.equal(error.llvmAbiMismatch.symbol, longSymbol);
      assert.equal(error.llvmAbiDifferences.samples[0].symbol.length, 1024);
      assert.equal(error.llvmAbiDifferences.samples[0].symbolTruncated, true);
      assert.equal(error.llvmAbiDifferences.truncated, false);
      return true;
    },
  );
  assert.equal(verifyLlvmCompatibility(baseline, candidate).baselineExports, 2);
});
test("maintained LLVM source build has signatures, honest packaging, complete target/ABI and unit gates", () => {
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  );
  assert.match(script, /gpgv --keyring/);
  assert.match(script, /dpkg-source -x llvm-toolchain-19_19.1.7-3.dsc/);
  assert.match(script, /LLVM_ENABLE_LIBXML2=OFF/);
  assert.match(script, /CMAKE_C_COMPILER=clang-19/);
  assert.match(script, /CMAKE_CXX_COMPILER=clang\+\+-19/);
  assert.match(script, /LLVM_TARGETS_TO_BUILD=all/);
  assert.match(script, /LLVM_DYLIB_COMPONENTS=all/);
  assert.match(script, /LLVM_ENABLE_FFI=ON/);
  assert.match(script, /LLVM_ENABLE_Z3_SOLVER=ON/);
  assert.match(script, /LLVM_POLLY_LINK_INTO_TOOLS=ON/);
  assert.match(script, /LLVM_ENABLE_ASSERTIONS=ON/);
  assert.match(script, /-DLLVM_ABI_BREAKING_CHECKS=FORCE_OFF/);
  assert.doesNotMatch(script, /-DLLVM_ENABLE_ABI_BREAKING_CHECKS=/);
  assert.match(script, /LLVM_ABI_BREAKING_CHECKS:STRING=FORCE_OFF/);
  assert.match(script, /#define LLVM_ENABLE_ABI_BREAKING_CHECKS 0/);
  assert.ok(
    script.indexOf("#define LLVM_ENABLE_ABI_BREAKING_CHECKS 0") <
      script.indexOf("timeout 7200"),
  );
  assert.match(script, /timeout 1800[^\n]+check-llvm-unit/);
  assert.match(
    script,
    /timeout 7200[^\n]+--parallel "\$native_jobs" --target LLVM llvm-config/,
  );
  assert.match(script, /dpkg-shlibdeps -O/);
  assert.match(script, /dpkg-gencontrol[^\n]+vaettir1/);
  assert.match(script, /check-llvm-package.mjs/g);
  assert.match(script, /clang-19 -std=c11 -O2 -Wall -Wextra -Werror/);
  assert.match(script, /readelf -d \/build\/llvm-cpu-jit/);
  assert.match(script, /! grep -E 'RPATH\|RUNPATH'/);
  assert.match(script, /timeout 10 \/build\/llvm-cpu-jit/);
  assert.doesNotMatch(
    script,
    /--force-depends|--allow-unauthenticated|nocheck|\|\| true|libxml.*\.so.*ln/,
  );
  const docker = readFileSync(
    new URL("../Dockerfile.api", import.meta.url),
    "utf8",
  );
  assert.match(
    docker,
    /COPY --from=llvm-build[^\n]+libllvm19_19.1.7-3\+vaettir1/,
  );
  assert.match(docker, /dpkg-query[^\n]+libxml2/);
  assert.match(
    docker,
    /^RUN --network=none node scripts\/check-browser-graphics.mjs$/m,
  );
  assert.match(
    docker,
    /COPY --from=llvm-build \/build\/llvm-cpu-jit \/usr\/share\/vaettir\/llvm-cpu-jit/,
  );
  assert.match(
    docker,
    /^RUN --network=none node scripts\/check-mesa-runtime.mjs$/m,
  );
});
test("release ABI policy is independent from a mandatory complete assertion-enabled unit configuration", () => {
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  );
  assert.match(script, /-DCMAKE_BUILD_TYPE=RelWithDebInfo/);
  assert.match(script, /-DCMAKE_CXX_FLAGS_RELWITHDEBINFO='-O2 -DNDEBUG -g1'/);
  assert.match(
    script,
    /configure_llvm \/build\/llvm-build \\\n\s+-DLLVM_ENABLE_ASSERTIONS=OFF \\\n\s+-DLLVM_BUILD_LLVM_DYLIB=ON -DLLVM_LINK_LLVM_DYLIB=ON/,
  );
  assert.match(
    script,
    /configure_llvm \/build\/llvm-assert-build \\\n\s+-DLLVM_ENABLE_ASSERTIONS=ON \\\n\s+-DLLVM_BUILD_LLVM_DYLIB=OFF -DLLVM_LINK_LLVM_DYLIB=OFF/,
  );
  assert.match(
    script,
    /verify_llvm_configuration release \/build\/llvm-build OFF ON/,
  );
  assert.match(
    script,
    /verify_llvm_configuration assertions \/build\/llvm-assert-build ON OFF/,
  );
  assert.match(script, /Effective NDEBUG policy mismatch/);
  assert.match(script, /Release ABI must not include assertion-on objects/);
  assert.match(
    script,
    /timeout 60 ninja -C \/build\/llvm-build -n LLVM llvm-config check-llvm-unit/,
  );
  assert.match(
    script,
    /timeout 60 ninja -C \/build\/llvm-assert-build -n check-llvm-unit/,
  );
  const release = script.indexOf(
    'timeout 1800 cmake --build /build/llvm-build --parallel "$native_jobs" --target check-llvm-unit',
  );
  const asserted = script.indexOf(
    'timeout 7200 cmake --build /build/llvm-assert-build --parallel "$native_jobs" --target check-llvm-unit',
  );
  const abi = script.indexOf(
    "/build/llvm-build/lib/libLLVM.so.19.1 /build/llvm-abi.json",
  );
  assert.ok(release > 0 && asserted > release && abi > asserted);
  assert.match(
    script,
    /llvm-release-configuration.json \/build\/llvm-assertions-configuration.json \/build\/llvm-build-graphs.json/,
  );
  assert.doesNotMatch(script, /-DCMAKE_BUILD_TYPE=Release(?:\s|$)/);
});
test("strict early ABI failure stops the real builder sequence before either unit graph", () => {
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const start = script.indexOf(
    'timeout 7200 cmake --build /build/llvm-build --parallel "$native_jobs" --target LLVM llvm-config',
  );
  const end = script.indexOf("# Static asserted objects/tests", start);
  assert.ok(start > 0 && end > start);
  const sequence = script.slice(start, end);
  assert.equal(
    sequence.match(/node \/build\/scripts\/check-llvm-package\.mjs/g)?.length,
    1,
  );
  assert.match(sequence, /\/build\/llvm-early-abi.json/);
  // Exercise the actual shell sequence with synthetic command implementations.
  // No compiler, ELF, source download, database, cloud or unit runner is invoked.
  const fixture = `set -eu
native_jobs=2
build_mode=complete
timeout() {
  printf '%s\\n' "timeout:$*"
  case "$*" in
    *'--target LLVM llvm-config')
      if test "$FAILURE" = core; then return 38; fi ;;
    *'--target check-llvm-unit')
      if test "$FAILURE" = unit; then return 39; fi ;;
    *) return 40 ;;
  esac
}
node() {
  printf '%s\\n' "node:$*"
  if test "$FAILURE" = abi; then return 37; fi
}
${sequence}`;
  const shell =
    process.platform === "win32"
      ? "C:/Program Files/Git/bin/bash.exe"
      : "/bin/sh";
  const run = (failure) =>
    spawnSync(shell, ["-s"], {
      input: fixture,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 8192,
      windowsHide: true,
      env: {
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
        FAILURE: failure,
      },
    });
  for (const [failure, expectedStatus, expectedCalls] of [
    ["core", 38, 1],
    ["abi", 37, 2],
    ["unit", 39, 3],
    ["none", 0, 3],
  ]) {
    const result = run(failure);
    assert.ifError(result.error);
    assert.equal(result.status, expectedStatus, result.stderr);
    const calls = result.stdout.trim().split("\n");
    assert.equal(calls.length, expectedCalls);
    assert.match(calls[0], /--target LLVM llvm-config$/);
    if (calls.length > 1)
      assert.equal(
        calls[1],
        "node:/build/scripts/check-llvm-package.mjs /usr/lib/x86_64-linux-gnu/libLLVM.so.19.1 /build/llvm-build/lib/libLLVM.so.19.1 /build/llvm-early-abi.json",
      );
    if (calls.length > 2) assert.match(calls[2], /--target check-llvm-unit$/);
  }
  const early = script.indexOf("/build/llvm-early-abi.json");
  const releaseUnit = script.indexOf(
    'timeout 1800 cmake --build /build/llvm-build --parallel "$native_jobs" --target check-llvm-unit',
  );
  const assertedUnit = script.indexOf(
    'timeout 7200 cmake --build /build/llvm-assert-build --parallel "$native_jobs" --target check-llvm-unit',
  );
  const final = script.indexOf(
    "/build/llvm-build/lib/libLLVM.so.19.1 /build/llvm-abi.json",
  );
  const stripped = script.indexOf("/build/llvm-stripped-abi.json");
  const packaged = script.indexOf("dpkg-deb --root-owner-group --build");
  assert.ok(
    early > start &&
      releaseUnit > early &&
      assertedUnit > releaseUnit &&
      final > assertedUnit &&
      stripped > final &&
      packaged > stripped,
  );
  assert.match(
    script.slice(0, start),
    /if test "\$build_mode" = configure-only;/,
  );
});

test("release-core diagnosis cannot run units, produce packages or feed runtime images", () => {
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const early = script.indexOf("/build/llvm-early-abi.json");
  const stop = script.indexOf(
    'if test "$build_mode" = release-core-only; then',
  );
  const units = script.indexOf("timeout 1800 cmake --build /build/llvm-build");
  assert.ok(early > 0 && stop > early && units > stop);
  const branch = script.slice(stop, units);
  assert.match(branch, /exit 0\nfi/);
  assert.match(branch, /releaseCoreCompiled: true/);
  assert.match(branch, /earlyAbiAcceptance: true/);
  for (const key of [
    "unitAcceptance",
    "packageCreated",
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ]) {
    assert.ok(branch.includes(key + ": false"), key);
  }
  assert.doesNotMatch(branch, /dpkg-deb|check-llvm-unit|docker push/);
  const docker = readFileSync(
    new URL("../Dockerfile.api", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  assert.match(
    docker,
    /^FROM llvm-build-inputs AS llvm-release-core-only\nLABEL vaettir.artifact-purpose="llvm-release-core-only" vaettir.runtime-eligible="false"\nRUN sh \/build\/scripts\/build-llvm-runtime.sh --release-core-only$/m,
  );
  assert.doesNotMatch(
    docker,
    /(?:COPY --from=|^FROM )llvm-release-core-only(?:\s|$)/m,
  );
  assert.match(
    docker,
    /^FROM llvm-build-inputs AS llvm-build\nRUN sh \/build\/scripts\/build-llvm-runtime.sh$/m,
  );
  assert.match(docker, /COPY --from=llvm-build \/build\/libllvm19/);
});

test("weak template functions and weak virtual-table storage remain strictly ABI guarded", () => {
  const release = {
    ...baseline,
    symbols:
      "AccelTable_addName@@LLVM_19.1 W 123 23\n_ZTV_DWARF5AccelTableData@@LLVM_19.1 V 321 28\n",
  };
  const compatible = {
    ...candidate,
    symbols: release.symbols.replace("123 23", "456 80"),
  };
  assert.equal(verifyLlvmCompatibility(release, compatible).baselineExports, 2);
  for (const symbols of [
    compatible.symbols.replace(" V 321 28", " V 321 30"),
    compatible.symbols.replace(" W ", " T "),
    "_ZTV_DWARF5AccelTableData@@LLVM_19.1 V 321 28\n",
  ])
    assert.throws(
      () => verifyLlvmCompatibility(release, { ...compatible, symbols }),
      /LLVM exported ABI changed/,
    );
});
