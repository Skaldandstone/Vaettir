import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  nativeBuildConcurrency,
  cgroupCpuLimit,
  MAX_NATIVE_BUILD_JOBS,
} from "./native-build-concurrency.mjs";
const gib = 1024 ** 3;
test("compiler concurrency respects CPU reserve, memory budget and hard ceiling", () => {
  for (const [cpus, memory, jobs] of [
    [2, 4, 1],
    [4, 8, 2],
    [8, 16, 6],
    [72, 144, 24],
    [36, 72, 24],
    [36, 16, 6],
    [8, 72, 6],
    [36, 32, 14],
    [16, 32, 14],
    [8, 4, 1],
    [1, 1, 1],
  ]) {
    assert.equal(
      nativeBuildConcurrency({ cpus, memoryBytes: memory * gib }),
      jobs,
    );
  }
  for (const cpus of [0, -1, 1.5, Infinity, 1025])
    assert.throws(() =>
      nativeBuildConcurrency({ cpus, memoryBytes: 16 * gib }),
    );
  for (const memoryBytes of [0, -1, NaN, Infinity, 1.5])
    assert.throws(() => nativeBuildConcurrency({ cpus: 8, memoryBytes }));
});
test("larger workers cannot bypass reserves or the absolute compiler ceiling", () => {
  assert.equal(MAX_NATIVE_BUILD_JOBS, 24);
  for (const cpus of [1, 2, 4, 8, 16, 36, 72, 1024]) {
    for (const memory of [1, 4, 8, 16, 32, 48, 72, 144, 1024]) {
      const jobs = nativeBuildConcurrency({ cpus, memoryBytes: memory * gib });
      assert.ok(
        Number.isSafeInteger(jobs) &&
          jobs >= 1 &&
          jobs <= MAX_NATIVE_BUILD_JOBS,
      );
      if (jobs > 1) {
        assert.ok(jobs + 2 <= cpus, "Two CPUs stay reserved");
        assert.ok(
          jobs * 2 + 4 <= memory,
          "Compiler memory and reserve fit the worker",
        );
      }
    }
  }
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  );
  assert.match(
    script,
    new RegExp(`Number\\(jobs\\) <= ${MAX_NATIVE_BUILD_JOBS}`),
  );
});
test("both compile and all unit gates use bounded resource jobs with one linker", () => {
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  );
  assert.match(
    script,
    /native_jobs=\$\(node \/build\/scripts\/native-build-concurrency\.mjs\)/,
  );
  assert.match(script, /LLVM_PARALLEL_LINK_JOBS=1/);
  assert.match(script, /LLVM_PARALLEL_COMPILE_JOBS="\$native_jobs"/);
  assert.match(
    script,
    /timeout 7200[^\n]+--parallel "\$native_jobs" --target LLVM llvm-config/,
  );
  assert.match(
    script,
    /timeout 1800[^\n]+--parallel "\$native_jobs" --target check-llvm-unit/,
  );
  assert.match(
    readFileSync(new URL("../Dockerfile.api", import.meta.url), "utf8"),
    /COPY scripts\/fetch-runtime-vendor-sources[^\n]+native-build-concurrency\.mjs[^\n]+\/build\/scripts\//,
  );
});
test("cgroup CPU quota can only lower effective affinity capacity", () => {
  assert.equal(cgroupCpuLimit("max 100000\n"), null);
  assert.equal(cgroupCpuLimit("400000 100000"), 4);
  assert.equal(cgroupCpuLimit("150000 100000"), 1);
  for (const input of [
    "max",
    "0 100000",
    "100000 0",
    "nan 100000",
    "-1 100000",
    "1 2 3",
  ])
    assert.throws(() => cgroupCpuLimit(input));
});
