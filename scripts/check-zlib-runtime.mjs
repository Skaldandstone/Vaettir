import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
export function requireZlibNegativeControl({ diagnostic, status, signal }) {
  if (
    typeof diagnostic !== "string" ||
    diagnostic.length > 32768 ||
    !((Number.isInteger(status) && status !== 0) || signal === "SIGABRT") ||
    !/\bERROR: AddressSanitizer: (heap-buffer-overflow|heap-use-after-free|SEGV)\b/.test(
      diagnostic,
    ) ||
    !/#\d+ .*\bin gz_write [^\n]*\/unpatched\/gzwrite\.c:\d+/.test(
      diagnostic,
    ) ||
    !/#\d+ .*\bin gzwrite [^\n]*\/unpatched\/gzwrite\.c:\d+/.test(diagnostic) ||
    !/#\d+ .*\bin nonblocking [^\n]*\/zlib-runtime-regression\.c:\d+/.test(
      diagnostic,
    ) ||
    !/SUMMARY: AddressSanitizer:/.test(diagnostic) ||
    !/\bABORTING\b/.test(diagnostic)
  )
    throw Error(
      "Negative control did not reproduce the specific zlib write fault",
    );
  // An out-of-range write through libc can be reported as SEGV rather than a
  // heap-redzone violation. Require write attribution, not an arbitrary crash.
  if (
    /ERROR: AddressSanitizer: SEGV\b/.test(diagnostic) &&
    !/The signal is caused by a WRITE memory access\./.test(diagnostic)
  )
    throw Error("Negative control did not identify a write memory fault");
  return {
    reproduced: true,
    reporter: /ERROR: AddressSanitizer: SEGV\b/.test(diagnostic)
      ? "write-SEGV"
      : "heap-write",
  };
}
export function zlibElfContract(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 64 ||
    bytes.length > 2_000_000 ||
    bytes.subarray(0, 4).toString("hex") !== "7f454c46" ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes.readUInt16LE(18) !== 62
  )
    throw Error("Expected bounded x86_64 ELF64 zlib");
  const integer = (position) => {
    if (position < 0 || position + 8 > bytes.length)
      throw Error("ELF offset bounds");
    const value = Number(bytes.readBigUInt64LE(position));
    if (!Number.isSafeInteger(value)) throw Error("ELF integer bounds");
    return value;
  };
  const start = integer(40),
    size = bytes.readUInt16LE(58),
    count = bytes.readUInt16LE(60);
  if (
    size !== 64 ||
    count < 1 ||
    count > 256 ||
    start + size * count > bytes.length
  )
    throw Error("ELF section bounds");
  const sections = Array.from({ length: count }, (_, i) => {
    const offset = start + i * size;
    const section = {
      type: bytes.readUInt32LE(offset + 4),
      offset: integer(offset + 24),
      size: integer(offset + 32),
      link: bytes.readUInt32LE(offset + 40),
      entry: integer(offset + 56),
    };
    if (section.type !== 8 && section.offset + section.size > bytes.length)
      throw Error("ELF data bounds");
    return section;
  });
  const string = (table, offset) => {
    if (!table || table.type !== 3 || offset < 0 || offset >= table.size)
      throw Error("ELF string bounds");
    const end = bytes.indexOf(0, table.offset + offset);
    if (
      end < 0 ||
      end >= table.offset + table.size ||
      end - table.offset - offset > 256
    )
      throw Error("ELF unterminated string");
    return bytes.toString("utf8", table.offset + offset, end);
  };
  const dynamic = sections.find((s) => s.type === 6);
  if (!dynamic || dynamic.entry !== 16 || dynamic.size % 16)
    throw Error("Missing ELF dynamic table");
  let soname;
  for (let i = 0; i < dynamic.size; i += 16)
    if (integer(dynamic.offset + i) === 14)
      soname = string(sections[dynamic.link], integer(dynamic.offset + i + 8));
  const symbols = sections.find((s) => s.type === 11),
    versym = sections.find((s) => s.type === 0x6fffffff),
    verdef = sections.find((s) => s.type === 0x6ffffffd);
  if (
    !symbols ||
    symbols.entry !== 24 ||
    symbols.size % 24 ||
    !versym ||
    versym.size < (symbols.size / 24) * 2 ||
    !verdef
  )
    throw Error("Missing versioned ELF exports");
  const versions = new Map();
  let position = verdef.offset;
  for (let i = 0; i < 128; i++) {
    if (position + 20 > verdef.offset + verdef.size)
      throw Error("ELF version bounds");
    const index = bytes.readUInt16LE(position + 4),
      aux = bytes.readUInt32LE(position + 12),
      next = bytes.readUInt32LE(position + 16);
    if (aux < 20 || position + aux + 8 > verdef.offset + verdef.size)
      throw Error("ELF version auxiliary bounds");
    versions.set(
      index,
      string(sections[verdef.link], bytes.readUInt32LE(position + aux)),
    );
    if (next === 0) break;
    if (
      next < 20 ||
      position + next >= verdef.offset + verdef.size ||
      i === 127
    )
      throw Error("ELF version chain bounds");
    position += next;
  }
  const exports = [],
    abi = [];
  for (let i = 0; i < symbols.size / 24; i++) {
    const offset = symbols.offset + i * 24,
      info = bytes[offset + 4],
      visibility = bytes[offset + 5] & 3,
      defined = bytes.readUInt16LE(offset + 6) !== 0;
    if (!defined || ![1, 2].includes(info >> 4) || ![0, 3].includes(visibility))
      continue;
    const name = string(sections[symbols.link], bytes.readUInt32LE(offset));
    const versionIndex = bytes.readUInt16LE(versym.offset + i * 2),
      version = versions.get(versionIndex & 0x7fff);
    if ((versionIndex & 0x7fff) > 1 && !version)
      throw Error("Unknown export version");
    if (name) {
      const identity = `${name}@${version ?? "GLOBAL"}${versionIndex & 0x8000 ? ":hidden" : ":default"}`;
      exports.push(identity);
      const type = info & 15;
      abi.push({
        identity,
        type,
        ...(type !== 2 && type !== 10 ? { bytes: integer(offset + 16) } : {}),
      });
    }
  }
  return {
    soname,
    exports: exports.sort(),
    abi,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
export function requireZlibCompatibility(candidate, baseline) {
  if (candidate.soname !== "libz.so.1" || baseline.soname !== "libz.so.1")
    throw Error("zlib SONAME changed");
  const available = new Set(candidate.exports);
  const missing = baseline.exports.filter((name) => !available.has(name));
  if (missing.length)
    throw Error(
      `Removed or changed zlib versioned exports: ${missing.join(",")}`,
    );
  if (!Array.isArray(baseline.abi) || !Array.isArray(candidate.abi))
    throw Error("Missing zlib export type and storage inventory");
  const after = new Map(candidate.abi.map((entry) => [entry.identity, entry]));
  for (const expected of baseline.abi) {
    const actual = after.get(expected.identity);
    if (
      !actual ||
      actual.type !== expected.type ||
      actual.bytes !== expected.bytes
    )
      throw Error("Changed zlib export type or object storage");
  }
  for (const name of [
    "gzwrite",
    "gzprintf",
    "gzclearerr",
    "compress2",
    "uncompress",
    "zlibVersion",
  ])
    if (!candidate.exports.some((value) => value.startsWith(`${name}@`)))
      throw Error("Missing required zlib API");
  return {
    soname: candidate.soname,
    baselineExports: baseline.exports.length,
    candidateExports: candidate.exports.length,
    sha256: candidate.sha256,
  };
}
export function zlibProbeEnvironment(libraryDirectory, sanitizer = false) {
  const env = {
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    LD_LIBRARY_PATH: libraryDirectory,
  };
  if (sanitizer) {
    env.ASAN_OPTIONS = "abort_on_error=1:detect_leaks=1";
    env.UBSAN_OPTIONS = "halt_on_error=1:print_stacktrace=1";
  }
  return env;
}
function requireProbeOutput(stdout) {
  if (
    typeof stdout !== "string" ||
    !stdout.includes("nonblocking EAGAIN") ||
    !stdout.includes("hard write error") ||
    !stdout.includes("round trips")
  )
    throw Error("Incomplete zlib regression proof");
}
export function requireInstalledZlibProof(candidate, proof) {
  if (
    candidate.soname !== "libz.so.1" ||
    proof?.soname !== candidate.soname ||
    !/^[a-f0-9]{64}$/.test(proof.sha256 ?? "") ||
    candidate.sha256 !== proof.sha256 ||
    !Number.isInteger(proof.baselineExports) ||
    proof.baselineExports < 1 ||
    !Number.isInteger(proof.candidateExports) ||
    proof.candidateExports < proof.baselineExports ||
    candidate.exports.length !== proof.candidateExports
  )
    throw Error("Installed zlib differs from the ABI-verified package");
  requireProbeOutput(proof.regression);
}
async function runZlibProbe(candidatePath, probePath, run) {
  if (!candidatePath.startsWith("/") || !probePath.startsWith("/"))
    throw Error("Absolute runtime paths required");
  const directory = candidatePath.slice(0, candidatePath.lastIndexOf("/"));
  const result = await run(probePath, [], {
    timeout: 15000,
    killSignal: "SIGKILL",
    maxBuffer: 8192,
    env: zlibProbeEnvironment(directory),
  });
  requireProbeOutput(result.stdout);
  return result.stdout.trim();
}
export async function checkInstalledZlibRuntime(
  candidatePath,
  proofPath,
  probePath,
  { run = execute, load = readFile } = {},
) {
  requireAbsolutePaths(candidatePath, proofPath, probePath);
  const receipt = await load(proofPath);
  if (receipt.length > 16384) throw Error("zlib receipt exceeds bounds");
  const proof = JSON.parse(receipt.toString("utf8"));
  const candidate = zlibElfContract(await load(candidatePath));
  requireInstalledZlibProof(candidate, proof);
  const regression = await runZlibProbe(candidatePath, probePath, run);
  return { ...proof, regression, installedPackageVerified: true };
}
export async function checkZlibRuntime(
  candidatePath,
  baselinePath,
  probePath,
  { run = execute, load = readFile } = {},
) {
  requireAbsolutePaths(candidatePath, baselinePath, probePath);
  const candidate = zlibElfContract(await load(candidatePath)),
    baseline = zlibElfContract(await load(baselinePath));
  const contract = requireZlibCompatibility(candidate, baseline);
  if (!baselinePath.startsWith("/"))
    throw Error("Absolute runtime paths required");
  return {
    ...contract,
    regression: await runZlibProbe(candidatePath, probePath, run),
  };
}
function requireAbsolutePaths(...paths) {
  if (paths.some((path) => typeof path !== "string" || !path.startsWith("/")))
    throw Error("Absolute runtime paths required");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const installed = process.argv[2] === "--installed";
    const [candidate, baseline, probe] = process.argv.slice(installed ? 3 : 2);
    if (!candidate || !baseline || !probe)
      throw Error(
        "Supply candidate, baseline and regression binary absolute paths",
      );
    console.log(
      JSON.stringify(
        await (installed ? checkInstalledZlibRuntime : checkZlibRuntime)(
          candidate,
          baseline,
          probe,
        ),
      ),
    );
  } catch {
    console.error(
      "zlib runtime verification failed; inputs and credentials were not logged.",
    );
    process.exitCode = 1;
  }
}
