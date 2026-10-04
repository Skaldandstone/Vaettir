// Independent final-state orchestration only. No import-time filesystem, shell,
// AWS, Git or Docker work. Operations MUST be supplied by a separately reviewed,
// hash-pinned Linux transport; synthetic implementations prove no native build.
// Never install this file into the nine inventoried /build/scripts inputs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { posix } from "node:path";

export const FINAL_PHASES = Object.freeze([
  "prepare",
  "release-core",
  "release-units",
  "assertion-compile-1",
  "assertion-compile-2",
  "assertion-compile-3",
  "final",
]);
export const FINAL_LIMITS = Object.freeze({
  receipt: 32768,
  log: 16777216,
  package: 512 * 1024 ** 2,
  expandedArchive: 512 * 1024 ** 2,
  packageEntries: 4096,
  packageFile: 256 * 1024 ** 2,
  files: 400000,
  inventoryBytes: 64 * 1024 ** 3,
  identityFile: 4 * 1024 ** 3,
});
const HEX = /^[a-f0-9]{64}$/;
const scriptNames = [
  "build-llvm-runtime.sh",
  "native-build-concurrency.mjs",
  "native-llvm-checkpoint.mjs",
  "fetch-runtime-vendor-sources.mjs",
  "runtime-vendor-sources.json",
  "check-llvm-package.mjs",
  "check-llvm-jit.c",
  "check-llvm-arm-defaults.cpp",
  "reconcile-llvm-arm-unit-fixture.mjs",
].sort();
const sha = (value) => createHash("sha256").update(value).digest("hex");
const keys = (value, names) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(
    Object.keys(value).sort(),
    [...names].sort(),
    "Exact fields required",
  );
};
const integer = (value, min, max) =>
  assert.ok(
    Number.isSafeInteger(value) && value >= min && value <= max,
    "Bounded safe integer required",
  );
const buffer = (value, max) => {
  assert.ok(
    Buffer.isBuffer(value) && value.length > 0 && value.length <= max,
    "Bounded exact bytes required",
  );
  return value;
};

// JSON.parse alone discards duplicate keys. Scan its grammar before parsing so
// conflicting receipt/proof keys cannot be normalized into an accepted object.
export function parseFinalJson(raw, max = FINAL_LIMITS.receipt) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    buffer(raw, max),
  );
  let offset = 0;
  const whitespace = () => {
    while (/\s/.test(text[offset] ?? "") && offset < text.length) offset++;
  };
  function string() {
    assert.equal(text[offset++], '"');
    const start = offset - 1;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === "\\") {
        offset++;
        continue;
      }
      if (char === '"') return JSON.parse(text.slice(start, offset));
    }
    throw Error("Unterminated JSON string");
  }
  function value(depth = 0) {
    assert.ok(depth <= 32, "JSON nesting bound exceeded");
    whitespace();
    if (text[offset] === '"') {
      string();
      return;
    }
    if (text[offset] === "{" || text[offset] === "[") {
      const object = text[offset++] === "{",
        end = object ? "}" : "]",
        seen = new Set();
      whitespace();
      if (text[offset] === end) {
        offset++;
        return;
      }
      for (;;) {
        whitespace();
        if (object) {
          const name = string();
          assert.ok(!seen.has(name), "Duplicate JSON field");
          seen.add(name);
          whitespace();
          assert.equal(text[offset++], ":");
        }
        value(depth + 1);
        whitespace();
        if (text[offset] === end) {
          offset++;
          return;
        }
        assert.equal(text[offset++], ",");
      }
    }
    const match =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(offset),
      );
    assert.ok(match, "Invalid JSON primitive");
    offset += match[0].length;
  }
  value();
  whitespace();
  assert.equal(offset, text.length, "Trailing JSON refused");
  return JSON.parse(text);
}

function inventory(value) {
  keys(value, ["sha256", "entries", "bytes"]);
  assert.match(value.sha256, HEX);
  integer(value.entries, 1, FINAL_LIMITS.files);
  integer(value.bytes, 1, FINAL_LIMITS.inventoryBytes);
}
function inputIdentity(value) {
  keys(value, [
    "scripts",
    "signedSources",
    "source",
    "toolchain",
    "baselineSha256",
    "configuration",
    "assertionPlanSha256",
  ]);
  for (const name of ["scripts", "signedSources", "source"])
    inventory(value[name]);
  keys(value.toolchain, [
    "compilerSha256",
    "compiler",
    "compilerPackage",
    "installedPackagesSha256",
  ]);
  assert.match(value.toolchain.compilerSha256, HEX);
  assert.match(value.toolchain.installedPackagesSha256, HEX);
  assert.ok(
    typeof value.toolchain.compiler === "string" &&
      Buffer.byteLength(value.toolchain.compiler) <= 1024,
  );
  assert.match(
    value.toolchain.compiler,
    /^Debian clang version 19\.1\.7(?: |$)/,
  );
  assert.equal(value.toolchain.compilerPackage, "1:19.1.7-3+b1");
  assert.match(value.baselineSha256, HEX);
  assert.match(value.assertionPlanSha256, HEX);
  assert.equal(value.configuration.length, 2);
  for (const item of value.configuration) {
    keys(item, ["cache", "commands"]);
    assert.match(item.cache, HEX);
    assert.match(item.commands, HEX);
  }
}

function receipt(raw, phase, expectedHash, previous, expectedInputs) {
  buffer(raw, FINAL_LIMITS.receipt);
  assert.equal(sha(raw), expectedHash, "Receipt bytes drift");
  const value = parseFinalJson(raw);
  keys(value, [
    "schemaVersion",
    "purpose",
    "phase",
    "predecessorSha256",
    "inputs",
    "inputsSha256",
    "state",
    "proof",
    "unitAcceptance",
    "packageAcceptance",
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ]);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.purpose, "llvm-builder-checkpoint-not-runtime");
  assert.equal(value.phase, phase);
  assert.equal(value.predecessorSha256, previous);
  inputIdentity(value.inputs);
  assert.deepEqual(value.inputs, expectedInputs);
  assert.equal(value.inputsSha256, sha(JSON.stringify(value.inputs)));
  keys(value.state, ["release", "assertions"]);
  inventory(value.state.release);
  inventory(value.state.assertions);
  assert.equal(value.unitAcceptance, phase === "final");
  assert.equal(value.packageAcceptance, phase === "final");
  for (const name of [
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ])
    assert.equal(value[name], false);
  const proofKeys =
    phase === "final"
      ? [
          "abiReceiptSha256",
          "packageSha256",
          "unitReceiptSha256",
          "llvm-abi.json",
          "llvm-cpu-jit",
          "llvm-arm-policy",
          "llvm-release-configuration.json",
          "llvm-assertions-configuration.json",
        ]
      : phase === "release-core"
        ? ["abiReceiptSha256"]
        : [];
  keys(value.proof, proofKeys);
  for (const digest of Object.values(value.proof)) assert.match(digest, HEX);
  return value;
}

/** Requires exact original compiler stream, not reconstructed CloudWatch lines.
 * Final transport must observe pinned script commands (e.g. `sh -x`, trace only).
 * Both original full targets run; skipped/unsupported remain separate facts. */
export function readFinalUnitStreams(raw) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    buffer(raw, FINAL_LIMITS.log),
  );
  const lines = text.split(/\r?\n/);
  const commands = [
    "+ timeout 1800 cmake --build /build/llvm-build --parallel 5 --target check-llvm-unit",
    "+ timeout 7200 cmake --build /build/llvm-assert-build --parallel 5 --target check-llvm-unit",
  ];
  const offsets = commands.map((command) => {
    const hits = lines.flatMap((line, index) =>
      line === command ? [index] : [],
    );
    assert.equal(
      hits.length,
      1,
      "Each exact complete unit command must be observed once",
    );
    return hits[0];
  });
  assert.ok(
    offsets[0] < offsets[1],
    "Release precedes independent assertions suite",
  );
  assert.equal(
    lines.filter((line) => /^Total Discovered Tests:/.test(line)).length,
    2,
    "Exactly two whole unit summaries required",
  );
  return offsets.map((start, index) => {
    const section = lines.slice(start + 1, offsets[index + 1] ?? lines.length);
    const totals = section.flatMap((line, position) =>
      /^Total Discovered Tests: (\d+)$/.test(line)
        ? [
            {
              total: Number(/^Total Discovered Tests: (\d+)$/.exec(line)[1]),
              position,
            },
          ]
        : [],
    );
    assert.equal(
      totals.length,
      1,
      "Complete unit summary missing or ambiguous",
    );
    const counts = {
      Passed: 0,
      Skipped: 0,
      Unsupported: 0,
      "Expectedly Failed": 0,
      Failed: 0,
      Unresolved: 0,
      "Unexpectedly Passed": 0,
      "Timed Out": 0,
    };
    const seen = new Set();
    for (const line of section.slice(totals[0].position + 1)) {
      if (!/^\s+[A-Za-z][A-Za-z ]*\s*:\s*\d+/.test(line)) continue;
      const match =
        /^\s+([A-Za-z][A-Za-z ]*?)\s*:\s*(\d+)(?: \([\d.]+%\))?\s*$/.exec(line);
      assert.ok(
        match && Object.hasOwn(counts, match[1]),
        "Unsupported lit result category",
      );
      assert.ok(!seen.has(match[1]), "Repeated unit result category");
      seen.add(match[1]);
      counts[match[1]] = Number(match[2]);
      integer(counts[match[1]], 0, 1000000);
    }
    integer(totals[0].total, 1, 1000000);
    assert.ok(counts.Passed > 0, "No passing tests observed");
    for (const name of [
      "Failed",
      "Unresolved",
      "Unexpectedly Passed",
      "Timed Out",
    ])
      assert.equal(counts[name], 0, "Unit failures refused");
    assert.equal(
      Object.values(counts).reduce((a, b) => a + b, 0),
      totals[0].total,
      "Unit totals not completely accounted",
    );
    return {
      variant: index ? "assertions" : "release",
      target: "check-llvm-unit",
      discovered: totals[0].total,
      passed: counts.Passed,
      skipped: counts.Skipped,
      unsupported: counts.Unsupported,
      expectedlyFailed: counts["Expectedly Failed"],
    };
  });
}

function safeArchivePath(value) {
  assert.ok(
    typeof value === "string" &&
      Buffer.byteLength(value) <= 256 &&
      ![...value].some(
        (char) =>
          char.charCodeAt(0) < 32 ||
          char.charCodeAt(0) === 127 ||
          char === "\\",
      ),
  );
  const path = value.startsWith("./") ? value.slice(2) : value;
  assert.ok(
    path &&
      !path.startsWith("/") &&
      !path.split("/").some((part) => part === ".." || part === "." || !part),
    "Unsafe package path",
  );
  return path;
}
function octal(raw, max) {
  assert.ok(
    raw.every((byte) => byte < 128),
    "Non-ASCII archive metadata refused",
  );
  const encoded = raw.toString("ascii");
  assert.match(
    encoded,
    /^ *[0-7]+(?:\0[\0 ]*| *)$/,
    "Ambiguous archive numeric padding refused",
  );
  const text = encoded.replace(/\0[\0 ]*$/, "").trim();
  const value = parseInt(text, 8);
  integer(value, 0, max);
  return value;
}
function tar(raw) {
  buffer(raw, FINAL_LIMITS.expandedArchive);
  assert.equal(raw.length % 512, 0);
  const entries = [],
    contents = new Map(),
    seen = new Set();
  let offset = 0,
    expanded = 0,
    ended = false,
    headers = 0;
  const field = (raw) => {
    const end = raw.indexOf(0);
    if (end >= 0)
      assert.ok(
        raw.subarray(end).every((byte) => byte === 0),
        "Ambiguous tar string refused",
      );
    return new TextDecoder("utf-8", { fatal: true }).decode(
      end < 0 ? raw : raw.subarray(0, end),
    );
  };
  while (offset < raw.length) {
    const block = raw.subarray(offset, offset + 512);
    offset += 512;
    if (block.every((byte) => byte === 0)) {
      assert.ok(
        raw.subarray(offset).every((byte) => byte === 0),
        "Trailing archive content refused",
      );
      ended = true;
      break;
    }
    assert.ok(
      ++headers <= FINAL_LIMITS.packageEntries,
      "Archive header bound exceeded",
    );
    let checksum = 0;
    for (let i = 0; i < 512; i++)
      checksum += i >= 148 && i < 156 ? 32 : block[i];
    assert.equal(
      octal(block.subarray(148, 156), 65535),
      checksum,
      "Tar checksum mismatch",
    );
    assert.ok(
      ["ustar\0", "ustar "].includes(
        block.subarray(257, 263).toString("ascii"),
      ),
      "Only bounded USTAR packages supported",
    );
    const name = field(block.subarray(0, 100)),
      prefix = field(block.subarray(345, 500));
    const type = String.fromCharCode(block[156] || 48),
      size = octal(block.subarray(124, 136), FINAL_LIMITS.packageFile);
    const mode = octal(block.subarray(100, 108), 0o7777);
    assert.equal(mode & 0o7000, 0, "Special mode refused");
    assert.equal(octal(block.subarray(108, 116), 0xffffffff), 0);
    assert.equal(octal(block.subarray(116, 124), 0xffffffff), 0);
    assert.ok(
      ["0", "2", "5"].includes(type),
      "Special/link/extended tar member refused",
    );
    let rawName = prefix ? `${prefix}/${name}` : name;
    if (type === "5") rawName = rawName.replace(/\/$/, "");
    if (rawName === "." && type === "5") {
      assert.equal(size, 0);
      continue;
    }
    const path = safeArchivePath(rawName);
    assert.ok(!seen.has(path), "Duplicate package path");
    seen.add(path);
    assert.ok(entries.length < FINAL_LIMITS.packageEntries);
    expanded += size;
    integer(expanded, 0, FINAL_LIMITS.expandedArchive);
    assert.ok(
      offset + Math.ceil(size / 512) * 512 <= raw.length,
      "Truncated tar member",
    );
    const data = raw.subarray(offset, offset + size);
    const next = offset + Math.ceil(size / 512) * 512;
    assert.ok(
      raw.subarray(offset + size, next).every((byte) => byte === 0),
      "Nonzero tar padding refused",
    );
    offset = next;
    if (type !== "0") assert.equal(size, 0);
    const link = type === "2" ? field(block.subarray(157, 257)) : null;
    if (link !== null) {
      assert.ok(
        !link.startsWith("/") &&
          !link
            .split("/")
            .some((part) => part === ".." || part === "." || !part),
      );
      safeArchivePath(link);
    }
    entries.push({
      path,
      kind: type === "0" ? "file" : type === "2" ? "symlink" : "directory",
      bytes: size,
      mode,
      linkTarget: link,
      sha256: type === "0" ? sha(data) : null,
    });
    if (type === "0") contents.set(path, data);
  }
  assert.ok(ended, "Tar end marker missing");
  for (const entry of entries)
    for (
      let parent = posix.dirname(entry.path);
      parent !== ".";
      parent = posix.dirname(parent)
    ) {
      const declared = entries.find((item) => item.path === parent);
      assert.ok(
        !declared || declared.kind === "directory",
        "Package parent is not a directory",
      );
    }
  return { entries, contents };
}

/** Decode only known compression as bytes, never run package programs/scripts.
 * The decoder must be fixed hash-reviewed transport code with expansion bound.
 * Extraction is NOT performed by this pure parser. */
export function inspectFinalDebianPackage(raw, decode) {
  buffer(raw, FINAL_LIMITS.package);
  assert.equal(raw.subarray(0, 8).toString(), "!<arch>\n");
  let offset = 8;
  const members = new Map();
  while (offset < raw.length) {
    assert.ok(offset + 60 <= raw.length, "Truncated ar header");
    const header = raw.subarray(offset, offset + 60);
    offset += 60;
    assert.ok(
      header.every((byte) => byte < 128),
      "Non-ASCII ar metadata refused",
    );
    assert.equal(header.subarray(58).toString(), "`\n");
    const name = header
      .subarray(0, 16)
      .toString("ascii")
      .trim()
      .replace(/\/$/, "");
    assert.match(
      name,
      /^(?:debian-binary|(?:control|data)\.tar\.(?:xz|gz|zst))$/,
    );
    assert.ok(!members.has(name), "Duplicate Debian archive member");
    const length = header.subarray(48, 58).toString("ascii").trim();
    assert.match(length, /^\d+$/);
    const size = Number(length);
    integer(size, 1, FINAL_LIMITS.package);
    assert.ok(offset + size <= raw.length);
    members.set(name, raw.subarray(offset, offset + size));
    offset += size;
    if (size % 2) {
      assert.equal(raw[offset], 10, "Invalid ar padding");
      offset++;
    }
  }
  assert.equal(offset, raw.length);
  assert.equal(members.size, 3);
  assert.equal(members.get("debian-binary")?.toString(), "2.0\n");
  const memberNames = [...members.keys()];
  assert.equal(memberNames[0], "debian-binary");
  assert.match(memberNames[1], /^control\.tar\.(?:gz|xz|zst)$/);
  assert.match(memberNames[2], /^data\.tar\.(?:gz|xz|zst)$/);
  const archive = (kind) => {
    const names = [...members.keys()].filter((name) =>
      name.startsWith(kind + ".tar."),
    );
    assert.equal(names.length, 1);
    return tar(
      buffer(
        decode(
          names[0].split(".").at(-1),
          members.get(names[0]),
          FINAL_LIMITS.expandedArchive,
        ),
        FINAL_LIMITS.expandedArchive,
      ),
    );
  };
  const control = archive("control"),
    data = archive("data");
  assert.ok(
    control.entries.every(
      (entry) =>
        entry.kind !== "symlink" &&
        ["control", "shlibs", "triggers"].includes(entry.path),
    ),
    "Unapproved maintainer/control programs refused",
  );
  assert.ok(
    control.contents.has("control") &&
      control.contents.has("shlibs") &&
      control.contents.has("triggers"),
  );
  const fields = {};
  for (const line of control.contents
    .get("control")
    .toString("utf8")
    .trimEnd()
    .split("\n")) {
    if (/^ /.test(line)) {
      assert.ok(
        fields.Description !== undefined,
        "Unsupported control continuation",
      );
      continue;
    }
    const match = /^([A-Za-z][A-Za-z-]*): (.*)$/.exec(line);
    assert.ok(
      match && !Object.hasOwn(fields, match[1]),
      "Malformed/duplicate control field",
    );
    fields[match[1]] = match[2];
  }
  assert.equal(fields.Package, "libllvm19");
  assert.equal(fields.Source, "llvm-toolchain-19 (1:19.1.7-3)");
  assert.equal(fields.Version, "1:19.1.7-3+vaettir1");
  assert.equal(fields.Architecture, "amd64");
  assert.ok(
    typeof fields.Depends === "string" && !/libxml/i.test(fields.Depends),
  );
  assert.equal(
    control.contents.get("shlibs").toString(),
    "libLLVM 19.1 libllvm19 (>= 1:19.1.7-3+vaettir1)\n",
  );
  assert.equal(
    control.contents.get("triggers").toString(),
    "activate-noawait ldconfig\n",
  );
  const directories = [
    "usr",
    "usr/lib",
    "usr/lib/x86_64-linux-gnu",
    "usr/share",
    "usr/share/doc",
    "usr/share/doc/libllvm19",
    "usr/share/vaettir",
  ];
  const proofNames = [
    "llvm-unstripped-abi.json",
    "llvm-source-manifest.json",
    "llvm-arm-policy-baseline.txt",
    "llvm-arm-unit-fixture-proof.json",
    "llvm-release-configuration.json",
    "llvm-assertions-configuration.json",
    "llvm-build-graphs.json",
    "llvm-arm-policy",
    "llvm-abi.json",
  ];
  const library = "usr/lib/x86_64-linux-gnu/libLLVM.so.19.1",
    link = "usr/lib/x86_64-linux-gnu/libLLVM-19.so";
  for (const entry of data.entries) {
    if (entry.kind === "directory")
      assert.ok(
        directories.includes(entry.path) ||
          entry.path.startsWith("usr/share/doc/libllvm19/"),
        "Unsupported package directory",
      );
    else if (entry.kind === "symlink") {
      assert.equal(entry.path, link);
      assert.equal(entry.linkTarget, "libLLVM.so.19.1");
    } else
      assert.ok(
        entry.path === library ||
          proofNames.some(
            (name) => entry.path === "usr/share/vaettir/" + name,
          ) ||
          entry.path.startsWith("usr/share/doc/libllvm19/"),
        "Unsupported package file",
      );
  }
  assert.ok(
    data.entries.some(
      (entry) => entry.path === link && entry.kind === "symlink",
    ),
  );
  assert.ok(data.contents.has(library));
  assert.ok(
    data.contents.has("usr/share/doc/libllvm19/copyright"),
    "Maintained copyright required",
  );
  for (const name of proofNames)
    assert.ok(
      data.contents.has("usr/share/vaettir/" + name),
      "Complete packaged proof required",
    );
  return {
    packageSha256: sha(raw),
    fields,
    entries: data.entries,
    contents: data.contents,
    libraryPath: library,
  };
}

function configuration(raw, variant) {
  const value = parseFinalJson(raw);
  keys(value, [
    "variant",
    "buildType",
    "assertions",
    "sharedDylib",
    "abiBreakingChecks",
    "perfJitComponent",
    "verifiedTranslationUnits",
    "flags",
    "effectiveNdebug",
  ]);
  assert.equal(value.variant, variant);
  assert.equal(value.buildType, "RelWithDebInfo");
  assert.equal(value.assertions, variant === "release" ? "OFF" : "ON");
  assert.equal(value.sharedDylib, variant === "release");
  assert.equal(value.abiBreakingChecks, false);
  assert.equal(value.perfJitComponent, true);
  integer(value.verifiedTranslationUnits, 110, 20000);
  assert.equal(value.flags, "-O2 -DNDEBUG -g1");
  assert.equal(
    value.effectiveNdebug,
    variant === "release" ? "defined" : "undefined",
  );
  return value;
}
function generatedPolicy(read, variant) {
  const directory =
    variant === "release" ? "/build/llvm-build" : "/build/llvm-assert-build";
  const cache = read(directory + "/CMakeCache.txt", 1048576)
    .toString("utf8")
    .split(/\r?\n/);
  const required = [
    "CMAKE_BUILD_TYPE:STRING=RelWithDebInfo",
    "CMAKE_C_FLAGS_RELWITHDEBINFO:STRING=-O2 -DNDEBUG -g1",
    "CMAKE_CXX_FLAGS_RELWITHDEBINFO:STRING=-O2 -DNDEBUG -g1",
    "LLVM_ENABLE_ASSERTIONS:BOOL=" + (variant === "release" ? "OFF" : "ON"),
    "LLVM_BUILD_LLVM_DYLIB:BOOL=" + (variant === "release" ? "ON" : "OFF"),
    "LLVM_LINK_LLVM_DYLIB:BOOL=" + (variant === "release" ? "ON" : "OFF"),
    "LLVM_USE_PERF:BOOL=ON",
    "LLVM_ABI_BREAKING_CHECKS:STRING=FORCE_OFF",
  ];
  for (const line of required) {
    const key = line.split("=")[0];
    assert.deepEqual(
      cache.filter((item) => item.startsWith(key + "=")),
      [line],
      "Generated policy mismatch",
    );
  }
  assert.ok(
    read(directory + "/include/llvm/Config/llvm-config.h", 1048576)
      .toString()
      .split(/\r?\n/)
      .includes("#define LLVM_USE_PERF 1"),
  );
  assert.ok(
    read(directory + "/include/llvm/Config/abi-breaking.h", 1048576)
      .toString()
      .split(/\r?\n/)
      .includes("#define LLVM_ENABLE_ABI_BREAKING_CHECKS 0"),
  );
  const commands = parseFinalJson(
    read(directory + "/compile_commands.json", 64 * 1024 ** 2),
    64 * 1024 ** 2,
  );
  assert.ok(Array.isArray(commands) && commands.length <= 20000);
  const relevant = commands.filter(
    (item) =>
      typeof item.file === "string" &&
      /^\/build\/llvm-source\/llvm\/(lib|unittests)\/.+\.(c|cc|cpp|cxx)$/.test(
        item.file,
      ),
  );
  assert.ok(
    relevant.filter((item) => item.file.includes("/llvm/lib/")).length >= 100 &&
      relevant.filter((item) => item.file.includes("/llvm/unittests/"))
        .length >= 10,
  );
  assert.equal(
    relevant.filter(
      (item) =>
        item.file ===
        "/build/llvm-source/llvm/lib/ExecutionEngine/PerfJITEvents/PerfJITEventListener.cpp",
    ).length,
    1,
  );
  for (const item of relevant) {
    assert.ok(
      typeof item.command === "string" &&
        Buffer.byteLength(item.command) <= 65536,
    );
    const flags = item.command.split(/\s+/);
    assert.ok(flags.includes("-O2") && flags.includes("-g1"));
    assert.ok(!flags.some((flag) => /^-O(?:0|1|3|s|z|fast)$/.test(flag)));
    const ndebug = flags.filter((flag) => /^-[DU]NDEBUG(?:=\S+)?$/.test(flag));
    assert.equal(
      ndebug.at(-1),
      variant === "release" ? "-DNDEBUG" : "-UNDEBUG",
    );
    if (variant === "release") assert.ok(!flags.includes("-UNDEBUG"));
  }
  return relevant.length;
}
function arm(raw) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    buffer(raw, 4096),
  );
  assert.ok(!text.includes("\r") && text.endsWith("\n"));
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, 34);
  assert.equal(new Set(lines).size, 34);
  assert.equal(lines.at(-1), "VAETTIR_LLVM_ARM_POLICY_VECTORS=33");
  for (const line of lines.slice(0, 33))
    assert.match(
      line,
      /^VAETTIR_LLVM_ARM_POLICY [a-z0-9-]+ march=[a-z0-9-]* cpu=[a-z0-9-]*$/,
    );
  assert.ok(
    lines.includes(
      "VAETTIR_LLVM_ARM_POLICY armeb-none-eabi march= cpu=arm926ej-s",
    ),
  );
  assert.ok(
    lines.includes(
      "VAETTIR_LLVM_ARM_POLICY arm-unknown-none-eabihf march= cpu=cortex-a8",
    ),
  );
  return raw;
}
function abi(raw, baselineHash, candidateHash) {
  const value = parseFinalJson(raw);
  keys(value, [
    "baselineExports",
    "candidateExports",
    "soname",
    "needed",
    "compiler",
    "compilerPackage",
    "baselineSha256",
    "candidateSha256",
    "source",
    "packageVersion",
    "change",
    "runtimeAccepted",
  ]);
  integer(value.baselineExports, 1, 1000000);
  integer(value.candidateExports, value.baselineExports, 1000000);
  assert.equal(value.soname, "libLLVM.so.19.1");
  assert.equal(value.baselineSha256, baselineHash);
  assert.equal(value.candidateSha256, candidateHash);
  assert.match(value.compiler, /^Debian clang version 19\.1\.7(?: |$)/);
  assert.equal(value.compilerPackage, "clang-19 1:19.1.7-3+b1");
  assert.equal(value.source, "Debian llvm-toolchain-19 1:19.1.7-3");
  assert.equal(value.packageVersion, "1:19.1.7-3+vaettir1");
  assert.equal(value.runtimeAccepted, false);
  assert.ok(
    typeof value.change === "string" && Buffer.byteLength(value.change) <= 1024,
  );
  assert.ok(
    Array.isArray(value.needed) &&
      value.needed.length > 0 &&
      value.needed.length <= 64 &&
      new Set(value.needed).size === value.needed.length,
  );
  for (const name of value.needed)
    assert.match(name, /^[A-Za-z0-9_.+-]{1,200}$/);
  assert.ok(!value.needed.some((name) => /^libxml/.test(name)));
  return value;
}

/** Input pins MUST come from independently reconstructed fresh flat lineage,
 * not stdout metadata or arbitrary caller paths. `ops.native` implementations
 * are the exact verified original nine-script APIs; fs/tool adapters are a
 * separately reviewed transport. This module has no production adapter yet.
 * Every actual inventory/ELF/probe is invoked here, not supplied as a receipt.
 * Extraction may only create the fixed exclusive /tmp directory and must be
 * bounded, no-follow and manifest-preserving; it must never install/run .deb.
 */
export function verifyNativeFreshFinalState(expected, ops) {
  keys(expected, [
    "sourceCommit",
    "sourceSha256",
    "verificationId",
    "inputs",
    "scriptPins",
    "sourceManifestSha256",
    "receipts",
    "coreCandidateSha256",
    "coreAbiReceiptSha256",
    "finalLogSha256",
  ]);
  assert.match(expected.sourceCommit, /^[a-f0-9]{40}$/);
  for (const name of [
    "sourceSha256",
    "verificationId",
    "sourceManifestSha256",
    "coreCandidateSha256",
    "coreAbiReceiptSha256",
    "finalLogSha256",
  ])
    assert.match(expected[name], HEX);
  inputIdentity(expected.inputs);
  keys(expected.scriptPins, scriptNames);
  for (const value of Object.values(expected.scriptPins))
    assert.match(value, HEX);
  assert.equal(expected.receipts.length, 7);
  expected.receipts.forEach((item, index) => {
    keys(item, ["phase", "sha256"]);
    assert.equal(item.phase, FINAL_PHASES[index]);
    assert.match(item.sha256, HEX);
  });
  keys(ops, [
    "read",
    "list",
    "exists",
    "hashFile",
    "compiler",
    "native",
    "inspectElf",
    "inspectDynamic",
    "decode",
    "extract",
    "runProbe",
    "readFinalLog",
  ]);
  keys(ops.native, [
    "inventoryTree",
    "hashCandidateLibrary",
    "verifyLlvmCompatibility",
  ]);
  for (const value of Object.values(ops))
    assert.ok(typeof value === "function" || value === ops.native);
  for (const value of Object.values(ops.native))
    assert.equal(typeof value, "function");
  const read = (path, max = FINAL_LIMITS.receipt) =>
    buffer(ops.read(path, max), max);
  const fileHash = (path, max = FINAL_LIMITS.identityFile) => {
    const item = ops.hashFile(path, max);
    keys(item, ["sha256", "bytes"]);
    assert.match(item.sha256, HEX);
    integer(item.bytes, 1, max);
    return item.sha256;
  };
  assert.equal(
    ops.exists("/build/llvm-phase-active.json"),
    false,
    "Failed/in-flight final cannot be accepted",
  );
  assert.deepEqual(ops.list("/build/scripts").sort(), scriptNames);
  for (const [name, digest] of Object.entries(expected.scriptPins))
    assert.equal(
      sha(read("/build/scripts/" + name, 1048576)),
      digest,
      "Original native script changed",
    );
  assert.equal(
    sha(read("/build/llvm-sources/source-manifest.json", 65536)),
    expected.sourceManifestSha256,
  );
  assert.deepEqual(
    ops.list("/build/llvm-phase-receipts").sort(),
    FINAL_PHASES.map((name) => name + ".json").sort(),
  );
  let previous = null;
  const receipts = [];
  for (const pin of expected.receipts) {
    const value = receipt(
      read("/build/llvm-phase-receipts/" + pin.phase + ".json"),
      pin.phase,
      pin.sha256,
      previous,
      expected.inputs,
    );
    receipts.push(value);
    previous = pin.sha256;
  }
  const final = receipts.at(-1);
  const tree = (path, extra = {}) => {
    const result = ops.native.inventoryTree(path, {
      maxFiles: FINAL_LIMITS.files,
      maxBytes: FINAL_LIMITS.inventoryBytes,
      ...extra,
    });
    inventory(result);
    return result;
  };
  const actualInputs = {
    scripts: tree("/build/scripts"),
    signedSources: tree("/build/llvm-sources"),
    source: tree("/build/llvm-source", {
      exclude: ["debian/libllvm19", "debian/libllvm19.substvars"],
    }),
    toolchain: ops.compiler(),
    baselineSha256: fileHash("/build/llvm-baseline-library"),
    configuration: ["llvm-build", "llvm-assert-build"].map((name) => ({
      cache: sha(read(`/build/${name}/CMakeCache.txt`, 1048576)),
      commands: sha(
        read(`/build/${name}/compile_commands.json`, 64 * 1024 ** 2),
      ),
    })),
    assertionPlanSha256: sha(
      read("/build/llvm-assertion-partitions.json", 4 * 1024 ** 2),
    ),
  };
  inputIdentity(actualInputs);
  assert.deepEqual(
    actualInputs,
    expected.inputs,
    "Actual full input identity changed",
  );
  const actualState = {
    release: tree("/build/llvm-build"),
    assertions: tree("/build/llvm-assert-build"),
  };
  assert.deepEqual(
    actualState,
    final.state,
    "Actual complete object/generated state changed",
  );
  const translationUnits = {
    release: generatedPolicy(read, "release"),
    assertions: generatedPolicy(read, "assertions"),
  };
  assert.equal(
    fileHash("/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1"),
    expected.inputs.baselineSha256,
  );
  const unstripped = ops.native.hashCandidateLibrary("/build", "release-core", {
    maxBytes: FINAL_LIMITS.identityFile,
  });
  keys(unstripped, ["sha256", "bytes"]);
  integer(unstripped.bytes, 1, FINAL_LIMITS.identityFile);
  assert.equal(unstripped.sha256, expected.coreCandidateSha256);
  const stripped = ops.native.hashCandidateLibrary("/build", "final", {
    maxBytes: FINAL_LIMITS.identityFile,
  });
  keys(stripped, ["sha256", "bytes"]);
  assert.match(stripped.sha256, HEX);
  integer(stripped.bytes, 1, FINAL_LIMITS.packageFile);
  const earlyRaw = read("/build/llvm-early-abi.json");
  assert.equal(sha(earlyRaw), expected.coreAbiReceiptSha256);
  assert.equal(
    receipts[1].proof.abiReceiptSha256,
    expected.coreAbiReceiptSha256,
  );
  const early = abi(
    earlyRaw,
    expected.inputs.baselineSha256,
    unstripped.sha256,
  );
  const unstrippedRaw = read("/build/llvm-abi.json");
  assert.equal(sha(unstrippedRaw), final.proof["llvm-abi.json"]);
  const unstrippedAbi = abi(
    unstrippedRaw,
    expected.inputs.baselineSha256,
    unstripped.sha256,
  );
  const strippedRaw = read("/build/llvm-stripped-abi.json");
  assert.equal(sha(strippedRaw), final.proof.abiReceiptSha256);
  const strippedAbi = abi(
    strippedRaw,
    expected.inputs.baselineSha256,
    stripped.sha256,
  );
  const baselineElf = ops.inspectElf(
    "/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1",
  );
  assert.equal(baselineElf.sha256, expected.inputs.baselineSha256);
  const compare = (candidate, observed) => {
    assert.equal(observed.sha256, candidate.candidateSha256);
    const actual = ops.native.verifyLlvmCompatibility(baselineElf, observed);
    assert.deepEqual(
      actual,
      {
        baselineExports: candidate.baselineExports,
        candidateExports: candidate.candidateExports,
        soname: candidate.soname,
        needed: candidate.needed,
      },
      "Actual full ABI comparison does not match proof",
    );
  };
  compare(early, ops.inspectElf("/build/llvm-build/lib/libLLVM.so.19.1"));
  assert.deepEqual(early.needed, unstrippedAbi.needed);
  assert.equal(early.baselineExports, unstrippedAbi.baselineExports);
  assert.equal(early.candidateExports, unstrippedAbi.candidateExports);
  const configurations = {};
  for (const name of ["release", "assertions"]) {
    const path = "llvm-" + name + "-configuration.json";
    const raw = read("/build/" + path);
    assert.equal(sha(raw), final.proof[path]);
    configurations[name] = configuration(raw, name);
    assert.equal(
      configurations[name].verifiedTranslationUnits,
      translationUnits[name],
      "Observed translation unit count differs from proof",
    );
  }
  const graphs = parseFinalJson(read("/build/llvm-build-graphs.json"));
  keys(graphs, ["release", "assertions"]);
  for (const value of Object.values(graphs)) {
    keys(value, ["scheduledCommands", "compilationCommands", "acceptance"]);
    integer(value.scheduledCommands, 100, 100000);
    integer(value.compilationCommands, 100, value.scheduledCommands);
    assert.equal(value.acceptance, false);
  }
  const plan = parseFinalJson(
    read("/build/llvm-assertion-partitions.json", 4 * 1024 ** 2),
    4 * 1024 ** 2,
  );
  // Prepare stored the complete UnitTests partition plan/hash, but not its raw
  // graph. A final `ninja -n` is now a DIFFERENT remaining-work graph. The exact
  // original plan is bound by all seven identical input identities; do not
  // substitute the configure check-llvm-unit dry run or invent a fresh graph.
  keys(plan, [
    "schemaVersion",
    "purpose",
    "graphSha256",
    "targets",
    "unitAcceptance",
  ]);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.purpose, "llvm-assertion-compilation-only");
  assert.equal(plan.unitAcceptance, false);
  assert.match(plan.graphSha256, HEX);
  assert.equal(plan.targets.length, 3);
  const targets = plan.targets.flat();
  integer(targets.length, 100, 20000);
  assert.equal(new Set(targets).size, targets.length);
  for (const group of plan.targets) {
    integer(group.length, 1, Math.ceil(targets.length / 3));
    for (const target of group)
      assert.ok(
        typeof target === "string" &&
          /^[A-Za-z0-9_./+-]+\.o$/.test(target) &&
          !target.startsWith("/") &&
          !target.startsWith("-") &&
          !target.split("/").includes(".."),
      );
  }
  const gatesRaw = read("/build/llvm-final-unit-gates.json");
  assert.equal(sha(gatesRaw), final.proof.unitReceiptSha256);
  assert.deepEqual(parseFinalJson(gatesRaw), {
    schemaVersion: 1,
    releaseTarget: "check-llvm-unit",
    assertionTarget: "check-llvm-unit",
    releasePassed: true,
    assertionPassed: true,
  });
  const rawLog = buffer(ops.readFinalLog(FINAL_LIMITS.log), FINAL_LIMITS.log);
  assert.equal(sha(rawLog), expected.finalLogSha256);
  const units = readFinalUnitStreams(rawLog);
  const baselineArm = arm(read("/build/llvm-arm-baseline.txt", 4096));
  assert.deepEqual(
    arm(read("/build/llvm-arm-candidate.txt", 4096)),
    baselineArm,
  );
  const fixture = parseFinalJson(
    read("/build/llvm-arm-unit-fixture-proof.json"),
  );
  keys(fixture, [
    "originalSha256",
    "repairedSha256",
    "baselineProofSha256",
    "fixtureAssertionsReconciled",
    "baselinePolicyUnchanged",
    "assertionsRemoved",
    "candidateDerivedExpectation",
  ]);
  assert.equal(
    fixture.originalSha256,
    "391705d2c4f2c2ba53ee85d0cd2c6d850c95dcb4ca9dd7659b3d04101bf2c9fa",
  );
  assert.match(fixture.repairedSha256, HEX);
  assert.equal(fixture.baselineProofSha256, sha(baselineArm));
  assert.equal(fixture.fixtureAssertionsReconciled, 1);
  assert.equal(fixture.baselinePolicyUnchanged, true);
  assert.equal(fixture.assertionsRemoved, 0);
  assert.equal(fixture.candidateDerivedExpectation, false);
  assert.equal(
    fileHash(
      "/build/llvm-source/llvm/unittests/TargetParser/TargetParserTest.cpp",
    ),
    fixture.repairedSha256,
  );
  assert.equal(
    fileHash("/build/llvm-source/debian/patches/930008-arm.diff"),
    "8167d94b8c47174a0112c960ee4d1f1132fadb9544a63be49e293fd3a8892510",
  );
  assert.equal(
    fileHash("/build/llvm-source/debian/patches/arm32-defaults.diff"),
    "25b1f5df39f3a7f260aaab0af0fdfe9c05abb08f2c9eb940d2e2c78698d73c32",
  );
  const packagePath = "/build/libllvm19_19.1.7-3+vaettir1_amd64.deb";
  const packageBytes = read(packagePath, FINAL_LIMITS.package);
  assert.equal(sha(packageBytes), final.proof.packageSha256);
  const packaged = inspectFinalDebianPackage(packageBytes, ops.decode);
  const dependencyPackages = {
    "libffi.so.8": "libffi8",
    "libedit.so.2": "libedit2",
    "libm.so.6": "libc6",
    "libz3.so.4": "libz3-4",
    "libz.so.1": "zlib1g",
    "libzstd.so.1": "libzstd1",
    "libstdc++.so.6": "libstdc++6",
    "libgcc_s.so.1": "libgcc-s1",
    "libc.so.6": "libc6",
    "ld-linux-x86-64.so.2": "libc6",
    "libtinfo.so.6": "libtinfo6",
    "libpfm.so.4": "libpfm4",
  };
  const declaredDependencies = packaged.fields.Depends.split(",").map(
    (part) => {
      const match = /^\s*([a-z0-9][a-z0-9+.-]*)(?:\s+\([^\n]+\))?\s*$/.exec(
        part,
      );
      assert.ok(match, "Unsupported dependency alternative or syntax");
      return match[1];
    },
  );
  for (const name of strippedAbi.needed) {
    assert.ok(
      Object.hasOwn(dependencyPackages, name),
      "Unsupported native dependency requires review",
    );
    assert.ok(
      declaredDependencies.includes(dependencyPackages[name]),
      "Package omitted actual native dependency",
    );
  }
  assert.equal(
    sha(packaged.contents.get(packaged.libraryPath)),
    stripped.sha256,
  );
  const copies = {
    "llvm-unstripped-abi.json": unstrippedRaw,
    "llvm-abi.json": strippedRaw,
    "llvm-arm-policy-baseline.txt": baselineArm,
    "llvm-source-manifest.json": read(
      "/build/llvm-sources/source-manifest.json",
      65536,
    ),
    "llvm-arm-unit-fixture-proof.json": read(
      "/build/llvm-arm-unit-fixture-proof.json",
    ),
    "llvm-release-configuration.json": read(
      "/build/llvm-release-configuration.json",
    ),
    "llvm-assertions-configuration.json": read(
      "/build/llvm-assertions-configuration.json",
    ),
    "llvm-build-graphs.json": read("/build/llvm-build-graphs.json"),
  };
  for (const [name, raw] of Object.entries(copies))
    assert.deepEqual(
      packaged.contents.get("usr/share/vaettir/" + name),
      raw,
      "Packaged proof differs from final builder",
    );
  const armPath = "/build/llvm-arm-policy",
    jitPath = "/build/llvm-cpu-jit";
  assert.equal(fileHash(armPath), final.proof["llvm-arm-policy"]);
  assert.equal(fileHash(jitPath), final.proof["llvm-cpu-jit"]);
  assert.equal(
    sha(packaged.contents.get("usr/share/vaettir/llvm-arm-policy")),
    final.proof["llvm-arm-policy"],
  );
  for (const path of [armPath, jitPath]) {
    const dynamic = ops.inspectDynamic(path);
    keys(dynamic, ["needed", "rpath", "runpath"]);
    assert.ok(dynamic.needed.includes("libLLVM.so.19.1"));
    assert.equal(dynamic.rpath, null);
    assert.equal(dynamic.runpath, null);
  }
  const extractionRoot = "/tmp/vaettir-fresh-final-" + expected.verificationId;
  assert.equal(
    ops.exists(extractionRoot),
    false,
    "Do not reuse/delete a pre-existing extraction root",
  );
  // `extract` owns no-follow creation/ancestor guards and must return exact
  // post-extraction inventory, not merely success. Never runs package scripts.
  const extracted = ops.extract(packageBytes, extractionRoot, packaged.entries);
  assert.deepEqual(
    extracted,
    packaged.entries,
    "Extracted package inventory changed",
  );
  const candidatePath = extractionRoot + "/" + packaged.libraryPath;
  assert.equal(
    fileHash(candidatePath, FINAL_LIMITS.packageFile),
    stripped.sha256,
  );
  compare(strippedAbi, ops.inspectElf(candidatePath));
  const libraryDirectory = extractionRoot + "/usr/lib/x86_64-linux-gnu";
  const probe = (path, outputMax) =>
    buffer(
      ops.runProbe({
        loader: "/lib64/ld-linux-x86-64.so.2",
        libraryDirectory,
        path,
        timeoutSeconds: 10,
        outputMax,
        environment: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
      }),
      outputMax,
    );
  assert.deepEqual(arm(probe(armPath, 4096)), baselineArm);
  assert.equal(
    probe(jitPath, 256).toString(),
    "VAETTIR_LLVM_CPU_JIT_ADD_4_7=11\n",
  );
  assert.equal(ops.exists("/build/llvm-phase-active.json"), false);
  assert.equal(
    ops.native.hashCandidateLibrary("/build", "final", {
      maxBytes: FINAL_LIMITS.identityFile,
    }).sha256,
    stripped.sha256,
    "Candidate changed during verification",
  );
  return {
    schemaVersion: 1,
    purpose: "fresh-native-final-state-verification-not-runtime",
    sourceCommit: expected.sourceCommit,
    sourceSha256: expected.sourceSha256,
    inputsSha256: final.inputsSha256,
    finalReceiptSha256: expected.receipts.at(-1).sha256,
    receiptChain: expected.receipts.map((item) => ({ ...item })),
    state: actualState,
    finalLogSha256: sha(rawLog),
    units,
    coreCandidateSha256: unstripped.sha256,
    strippedCandidateSha256: stripped.sha256,
    packageSha256: packaged.packageSha256,
    packageEntries: packaged.entries.length,
    armVectors: 33,
    fixedCandidateJitResult: 11,
    completeInputsAndObjectsRecomputed: true,
    operationsRequireVerifiedTransport: true,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
    deploymentAcceptance: false,
  };
}

/** Import-free reviewed source suitable for a hash-pinned external verifier.
 * The returned function receives explicit trusted Node builtins; it never
 * evals package/receipt/caller strings. Transport must verify THIS MODULE's
 * bytes before generating/running it and inject hash-verified native APIs.
 * Pure generation/VM tests are not actual Linux transport acceptance. */
export function nativeFreshFinalVerifierProgram() {
  const functions = [
    keys,
    integer,
    buffer,
    parseFinalJson,
    inventory,
    inputIdentity,
    receipt,
    readFinalUnitStreams,
    safeArchivePath,
    octal,
    tar,
    inspectFinalDebianPackage,
    configuration,
    generatedPolicy,
    arm,
    abi,
    verifyNativeFreshFinalState,
  ];
  return (
    `(function(builtins) {\n"use strict";\nconst {assert,createHash,posix,Buffer,TextDecoder}=builtins;\n` +
    `const FINAL_PHASES=Object.freeze(${JSON.stringify(FINAL_PHASES)});\n` +
    `const FINAL_LIMITS=Object.freeze(${JSON.stringify(FINAL_LIMITS)});\n` +
    `const HEX=/^[a-f0-9]{64}$/;\nconst scriptNames=${JSON.stringify(scriptNames)};\n` +
    `const sha=value=>createHash("sha256").update(value).digest("hex");\n` +
    functions
      .map((fn) =>
        fn.toString().startsWith("function ") ||
        fn.toString().startsWith("function(")
          ? fn.toString()
          : `const ${fn.name}=${fn.toString()};`,
      )
      .join("\n") +
    `\nreturn Object.freeze({verifyNativeFreshFinalState,inspectFinalDebianPackage,parseFinalJson,readFinalUnitStreams});\n})`
  );
}
