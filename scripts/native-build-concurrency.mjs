import { availableParallelism, totalmem } from "node:os";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

export function nativeBuildConcurrency({ cpus, memoryBytes }) {
  if (
    !Number.isSafeInteger(cpus) ||
    cpus < 1 ||
    cpus > 1024 ||
    !Number.isSafeInteger(memoryBytes) ||
    memoryBytes < 1
  ) {
    throw new Error("Invalid native build resource limits");
  }
  const gib = 1024 ** 3;
  // Reserve two CPUs and 4GiB for other build stages. Budget 2GiB per compiler
  // job and never exceed twelve, even on an unusually large host.
  return Math.max(
    1,
    Math.min(12, cpus - 2, Math.floor((memoryBytes - 4 * gib) / (2 * gib))),
  );
}

export function cgroupCpuLimit(text) {
  const values = text.trim().split(/\s+/);
  if (
    values.length !== 2 ||
    !/^\d+$/.test(values[1]) ||
    Number(values[1]) <= 0 ||
    !Number.isSafeInteger(Number(values[1]))
  )
    throw new Error("Invalid cgroup CPU budget");
  if (values[0] === "max") return null;
  if (
    !/^\d+$/.test(values[0]) ||
    Number(values[0]) <= 0 ||
    !Number.isSafeInteger(Number(values[0]))
  )
    throw new Error("Invalid cgroup CPU budget");
  return Math.max(1, Math.floor(Number(values[0]) / Number(values[1])));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 2 || process.platform !== "linux") {
    throw new Error("Native build concurrency accepts no arguments on Linux");
  }
  const host = totalmem();
  const constrained = process.constrainedMemory();
  let cpus = availableParallelism();
  try {
    const text = readFileSync("/sys/fs/cgroup/cpu.max", "utf8");
    if (text.length > 128) throw new Error("Invalid cgroup CPU budget");
    const quota = cgroupCpuLimit(text);
    if (quota !== null) cpus = Math.min(cpus, quota);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(
    nativeBuildConcurrency({
      cpus,
      memoryBytes: Math.min(host, constrained || host),
    }),
  );
}
