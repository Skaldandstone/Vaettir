import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
const LLVM = "/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1";
const RECEIPT = "/usr/share/vaettir/llvm-abi.json";
const JIT = "/usr/share/vaettir/llvm-cpu-jit";
const LLVM_VERSION = "1:19.1.7-3+vaettir1";
const JIT_RESULT = "VAETTIR_LLVM_CPU_JIT_ADD_4_7=11";

// Deliberately do not inherit PATH, LD_*, NODE_OPTIONS, credentials, proxies,
// HOME, user configuration or caller renderer-selection variables.
export function mesaChildEnvironment() {
  return { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
}

export function parseInstalledPackage(output, name) {
  const [status, version, architecture, ...extra] = output
    .trimEnd()
    .split("\t");
  if (
    status !== "ii " ||
    architecture !== "amd64" ||
    extra.length ||
    !/^[0-9][A-Za-z0-9.+:~-]*$/.test(version ?? "")
  )
    throw new Error(`Required installed amd64 package invalid: ${name}`);
  return version;
}

export function galliumPackagePath(output) {
  const matches = output
    .split(/\r?\n/)
    .filter((path) =>
      /^\/usr\/lib\/x86_64-linux-gnu\/libgallium-[A-Za-z0-9.+:~-]+\.so$/.test(
        path,
      ),
    );
  if (matches.length !== 1)
    throw new Error("Expected one package-owned Mesa Gallium DSO");
  return matches[0];
}

export function verifyLoaderOutput(stdout, stderr = "") {
  const text = `${stdout}\n${stderr}`;
  if (
    !stdout.trim() ||
    /not found|undefined symbol|not a dynamic executable|statically linked|error while loading|version [`'\w.]+[^\n]*not found/i.test(
      text,
    )
  )
    throw new Error(
      "Installed native loader dependency or relocation check failed",
    );
  const dependencies = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const resolved = /^\s*(\S+)\s+=>\s+(\/[^\s]+)\s+\(0x[0-9a-f]+\)\s*$/i.exec(
      line,
    );
    if (resolved) {
      if (dependencies.has(resolved[1]))
        throw new Error("Duplicate native loader dependency");
      dependencies.set(resolved[1], resolved[2]);
      continue;
    }
    if (!line.trim()) continue;
    if (/^\s*(?:linux-vdso\.so\.1|\/[^\s]+)\s+\(0x[0-9a-f]+\)\s*$/i.test(line))
      continue;
    throw new Error("Unrecognized native loader output");
  }
  if (!dependencies.has("libc.so.6"))
    throw new Error("Native loader omitted libc dependency");
  return dependencies;
}

async function hashFile(path, signal) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > 512 * 1024 * 1024)
    throw new Error("Installed LLVM DSO size invalid");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal }))
    hash.update(chunk);
  return hash.digest("hex");
}

async function readReceipt(path, options) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > 64 * 1024)
    throw new Error("Installed LLVM receipt size invalid");
  return readFile(path, options);
}

export async function checkMesaRuntime({
  runImpl = execute,
  readFileImpl = readReceipt,
  realpathImpl = realpath,
  hashFileImpl = hashFile,
  signal,
} = {}) {
  signal?.throwIfAborted();
  const options = {
    encoding: "utf8",
    env: mesaChildEnvironment(),
    timeout: 15_000,
    killSignal: "SIGKILL",
    maxBuffer: 256 * 1024,
    signal,
  };
  const run = async (command, args) => {
    signal?.throwIfAborted();
    // execFile rejects nonzero/timeout/abort. Do not replace the primary failure
    // with cleanup errors or interpret partial output from a failed command.
    return runImpl(command, args, options);
  };
  const packageVersion = async (name) =>
    parseInstalledPackage(
      (
        await run("/usr/bin/dpkg-query", [
          "-W",
          "-f=${db:Status-Abbrev}\t${Version}\t${Architecture}",
          name,
        ])
      ).stdout,
      name,
    );
  const llvmVersion = await packageVersion("libllvm19");
  const mesaVersion = await packageVersion("mesa-libgallium");
  if (llvmVersion !== LLVM_VERSION)
    throw new Error("Installed LLVM package version mismatch");
  const paths = (await run("/usr/bin/dpkg-query", ["-L", "mesa-libgallium"]))
    .stdout;
  const mesaPath = galliumPackagePath(paths);
  if (mesaPath !== `/usr/lib/x86_64-linux-gnu/libgallium-${mesaVersion}.so`)
    throw new Error("Installed Mesa DSO/package version mismatch");
  const llvmOwned = (
    await run("/usr/bin/dpkg-query", ["-L", "libllvm19"])
  ).stdout.split(/\r?\n/);
  if (!llvmOwned.includes(LLVM) || !llvmOwned.includes(RECEIPT))
    throw new Error("LLVM library/ABI receipt not package-owned");
  const llvmReal = await realpathImpl(LLVM);
  if (
    llvmReal !== LLVM ||
    (await realpathImpl(mesaPath)) !== mesaPath ||
    (await realpathImpl(JIT)) !== JIT
  )
    throw new Error("Unexpected native runtime symlink or library identity");
  const rawReceipt = await readFileImpl(RECEIPT, { encoding: "utf8", signal });
  if (Buffer.byteLength(rawReceipt) > 64 * 1024)
    throw new Error("LLVM receipt exceeds bound");
  const receipt = JSON.parse(rawReceipt);
  if (
    receipt.soname !== "libLLVM.so.19.1" ||
    receipt.packageVersion !== llvmVersion ||
    !/^[a-f0-9]{64}$/.test(receipt.candidateSha256 ?? "")
  )
    throw new Error("Installed LLVM ABI receipt identity invalid");
  const llvmSha256 = await hashFileImpl(LLVM, signal);
  if (llvmSha256 !== receipt.candidateSha256)
    throw new Error("Installed LLVM hash mismatch");
  const loaderChecks = [];
  for (const path of [LLVM, mesaPath, JIT]) {
    const output = await run("/usr/bin/ldd", ["-r", path]);
    const dependencies = verifyLoaderOutput(output.stdout, output.stderr);
    if (path !== LLVM) {
      const linkedLLVM = dependencies.get("libLLVM.so.19.1");
      if (!linkedLLVM || (await realpathImpl(linkedLLVM)) !== llvmReal)
        throw new Error(
          "Mesa/JIT does not resolve the verified installed LLVM",
        );
    }
    loaderChecks.push({ path, dependencies: Object.fromEntries(dependencies) });
  }
  const jit = await run(JIT, []);
  if (jit.stdout.trim() !== JIT_RESULT || jit.stderr.trim())
    throw new Error("Authored LLVM CPU JIT result mismatch");
  return {
    llvm: {
      path: LLVM,
      sha256: llvmSha256,
      package: "libllvm19",
      version: llvmVersion,
    },
    mesa: { path: mesaPath, package: "mesa-libgallium", version: mesaVersion },
    loaderChecks,
    cpuJit: "Authored fixed integer 4 + 7 = 11 via LLVM MCJIT native target",
    scope:
      "Installed shared-library relocation and authored CPU JIT only; not Mesa rendering, Chromium renderer selection or device acceptance",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (
    process.argv.length !== 2 ||
    process.platform !== "linux" ||
    process.arch !== "x64"
  )
    throw new Error(
      "Mesa runtime guard accepts no inputs and requires Linux amd64",
    );
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const deadline = setTimeout(cancel, 60_000);
  try {
    console.log(
      `Mesa/LLVM runtime verified: ${JSON.stringify(await checkMesaRuntime({ signal: controller.signal }))}`,
    );
  } catch (error) {
    console.error(
      `Mesa/LLVM runtime guard failed: ${error.name}: ${String(error.message).slice(0, 1024)}; no client input or credentials used.`,
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
