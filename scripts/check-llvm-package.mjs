import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function exportedSymbols(text) {
  const symbols = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const [name, type, , size] = line.trim().split(/\s+/);
    if (!name || !/^[A-Za-z]$/.test(type))
      throw new Error("Invalid ELF symbol inventory");
    if (symbols.has(name)) throw new Error("Duplicate ELF symbol identity");
    // Function bodies legitimately change; exported object/TLS storage must not.
    symbols.set(name, {
      type,
      size: /^[BbDdGgRrSsVvu]$/.test(type) ? size : undefined,
    });
  }
  return symbols;
}

export function verifyLlvmCompatibility(baseline, candidate) {
  if (
    baseline.soname !== "libLLVM.so.19.1" ||
    candidate.soname !== baseline.soname
  )
    throw new Error("LLVM SONAME changed");
  const before = exportedSymbols(baseline.symbols);
  const after = exportedSymbols(candidate.symbols);
  for (const [name, expected] of before) {
    const actual = after.get(name);
    if (
      !actual ||
      actual.type !== expected.type ||
      actual.size !== expected.size
    ) {
      const error = new Error(
        "LLVM exported ABI changed: " +
          name +
          "; expected=" +
          JSON.stringify(expected) +
          "; actual=" +
          JSON.stringify(actual ?? null),
      );
      error.llvmAbiMismatch = {
        symbol: name,
        expected,
        actual: actual ?? null,
        baselineExports: before.size,
        candidateExports: after.size,
      };
      throw error;
    }
  }
  if (!baseline.needed.includes("libxml2.so.2"))
    throw new Error("Unexpected LLVM baseline");
  if (candidate.needed.some((name) => /^libxml/.test(name)))
    throw new Error("LLVM still links XML");
  for (const name of baseline.needed.filter(
    (name) => name !== "libxml2.so.2",
  )) {
    if (!candidate.needed.includes(name))
      throw new Error("LLVM dependency unexpectedly removed: " + name);
  }
  return {
    baselineExports: before.size,
    candidateExports: after.size,
    soname: candidate.soname,
    needed: candidate.needed,
  };
}

function inspect(path) {
  const options = {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  };
  const dynamic = execFileSync("readelf", ["-d", path], options);
  return {
    soname: /\(SONAME\).*\[([^\]]+)\]/.exec(dynamic)?.[1],
    needed: [...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)].map(
      (match) => match[1],
    ),
    symbols: execFileSync(
      "nm",
      ["-D", "--defined-only", "--format=posix", path],
      options,
    ),
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [baselinePath, candidatePath, receipt] = process.argv.slice(2);
  if (!baselinePath || !candidatePath || !receipt)
    throw new Error("LLVM ABI paths required");
  const baseline = inspect(baselinePath);
  const candidate = inspect(candidatePath);
  // Builder-local only: a failed Docker layer is not a durable external artifact.
  // Small, hash-bound mismatch details below are retained in the build log.
  writeFileSync(
    receipt + ".inputs.json",
    JSON.stringify({ baseline, candidate }, null, 2) + "\n",
    { flag: "wx" },
  );
  let proof;
  try {
    proof = verifyLlvmCompatibility(baseline, candidate);
  } catch (error) {
    console.error(
      "LLVM ABI failure diagnostic: " +
        JSON.stringify({
          baselineSha256: baseline.sha256,
          candidateSha256: candidate.sha256,
          baselineSymbolsSha256: createHash("sha256")
            .update(baseline.symbols)
            .digest("hex"),
          candidateSymbolsSha256: createHash("sha256")
            .update(candidate.symbols)
            .digest("hex"),
          baselineSoname: baseline.soname,
          candidateSoname: candidate.soname,
          baselineNeeded: baseline.needed,
          candidateNeeded: candidate.needed,
          mismatch: error.llvmAbiMismatch ?? null,
          fullInventoriesBuilderLocalOnly: true,
        }),
    );
    throw error;
  }
  const compiler = execFileSync("clang++-19", ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 4096,
  }).split(/\r?\n/)[0];
  if (!/^Debian clang version 19\.1\.7(?: |$)/.test(compiler))
    throw new Error("Unexpected LLVM build compiler");
  const compilerPackageVersion = execFileSync(
    "dpkg-query",
    ["-W", "-f=${Version}", "clang-19"],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 4096 },
  ).trim();
  if (compilerPackageVersion !== "1:19.1.7-3+b1")
    throw new Error("Unexpected maintained compiler package");
  writeFileSync(
    receipt,
    JSON.stringify(
      {
        ...proof,
        compiler,
        compilerPackage: `clang-19 ${compilerPackageVersion}`,
        baselineSha256: baseline.sha256,
        candidateSha256: candidate.sha256,
        source: "Debian llvm-toolchain-19 1:19.1.7-3",
        packageVersion: "1:19.1.7-3+vaettir1",
        change:
          "Supported optional Windows manifest XML integration disabled; all targets/Polly configured and exported ABI preserved; Mesa runtime verification is separate",
        runtimeAccepted: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    "LLVM19 exported ABI/SONAME and actual XML dependency removal verified.",
  );
}
