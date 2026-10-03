import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(script, /timeout 7200[^\n]+--parallel "\$native_jobs" --target LLVM llvm-config/);
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
