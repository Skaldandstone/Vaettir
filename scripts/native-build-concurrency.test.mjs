import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  nativeBuildConcurrency,
  cgroupCpuLimit,
} from "./native-build-concurrency.mjs";
const gib = 1024 ** 3;
test("compiler concurrency respects CPU reserve, memory budget and hard ceiling", () => {
  for (const [cpus, memory, jobs] of [
    [2, 4, 1],
    [4, 8, 2],
    [8, 16, 6],
    [72, 144, 12],
    [36, 72, 12],
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
