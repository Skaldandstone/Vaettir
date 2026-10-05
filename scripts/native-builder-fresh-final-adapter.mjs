// Trusted fixed-path Linux operations, not a CLI, planner or release gate.
// Importing this module performs no filesystem, subprocess, Docker or AWS work.
// Transport MUST hash-pin this module/verifier, own an isolated non-networked
// container with no concurrent writer, and enforce an outer watchdog. The exact
// original synchronous inventory API cannot be interrupted by a JS timer.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { posix } from "node:path";
import {
  FINAL_LIMITS,
  FINAL_PHASES,
  inspectFinalDebianPackage,
} from "./native-builder-fresh-final-verifier.mjs";

const HEX = /^[a-f0-9]{64}$/;
const scripts = [
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
const GB = 1024 ** 3,
  MB = 1024 ** 2;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const exact = (value, names) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...names].sort());
};
const bounded = (value, max) => {
  assert.ok(
    Buffer.isBuffer(value) && value.length > 0 && value.length <= max,
    "Bounded bytes required",
  );
  return value;
};
const statId = (stat) => ({
  dev: stat.dev,
  ino: stat.ino,
  size: stat.size,
  mtimeMs: stat.mtimeMs,
  ctimeMs: stat.ctimeMs,
  mode: stat.mode,
  uid: stat.uid,
});
const objectId = (stat) => ({
  dev: stat.dev,
  ino: stat.ino,
  mode: stat.mode,
  uid: stat.uid,
});
const safeInteger = (value, min, max) =>
  assert.ok(
    Number.isSafeInteger(value) && value >= min && value <= max,
    "Safe bounded integer required",
  );
const environment = Object.freeze({
  PATH: "/usr/bin:/bin",
  LC_ALL: "C",
  LANG: "C",
  HOME: "/nonexistent",
});
// Fixed Linux cgroup metadata only. A missing v2 pair permits v1; malformed,
// partially present or inaccessible v2 metadata is never a fallback condition.
// Injected IO is a trusted synthetic-test boundary, not caller configuration.
export function readNativeFinalMemory(io = fs) {
  assert.ok(Number.isSafeInteger(io.constants.O_NOFOLLOW) && io.constants.O_NOFOLLOW > 0);
  const read = (path) => {
    let before;
    try {
      before = io.lstatSync(path);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    assert.ok(before.isFile() && !before.isSymbolicLink());
    assert.equal(io.realpathSync(path), path, "Aliased memory metadata refused");
    const identity = statId(before);
    const fd = io.openSync(path, io.constants.O_RDONLY | io.constants.O_NOFOLLOW);
    try {
      assert.deepEqual(statId(io.fstatSync(fd)), identity);
      const bytes = Buffer.alloc(129);
      let offset = 0, count;
      while ((count = io.readSync(fd, bytes, offset, bytes.length - offset, null))) {
        assert.ok(Number.isSafeInteger(count) && count > 0 && count <= bytes.length - offset);
        offset += count;
        assert.ok(offset <= 128, "Oversized memory metadata refused");
      }
      assert.deepEqual(statId(io.fstatSync(fd)), identity);
      assert.deepEqual(statId(io.lstatSync(path)), identity);
      assert.equal(io.realpathSync(path), path);
      const raw = bytes.subarray(0, offset);
      assert.ok(raw.length > 0 && raw.every((byte) => byte < 128));
      return raw.toString("ascii").trim();
    } finally {
      io.closeSync(fd);
    }
  };
  let limit = read("/sys/fs/cgroup/memory.max"),
    used = read("/sys/fs/cgroup/memory.current");
  if (limit === null && used === null) {
    limit = read("/sys/fs/cgroup/memory/memory.limit_in_bytes");
    used = read("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  }
  const amount = (value) => {
    assert.equal(typeof value, "string", "Complete memory metadata pair required");
    assert.match(value, /^(?:0|[1-9][0-9]*)$/);
    const number = Number(value);
    assert.ok(Number.isSafeInteger(number) && number >= 0, "Unsafe memory amount refused");
    return number;
  };
  return { limit: amount(limit), used: amount(used) };
}
const defaults = {
  fs,
  exec: execFileSync,
  importExact: (url) => import(url),
  clock: () => performance.now(),
  platform: () => process.platform,
  uid: () => process.getuid(),
  memory: () => readNativeFinalMemory(),
};

const fixedReads = new Map([
  ...scripts.map((name) => ["/build/scripts/" + name, MB]),
  ...FINAL_PHASES.map((name) => [
    "/build/llvm-phase-receipts/" + name + ".json",
    FINAL_LIMITS.receipt,
  ]),
  ["/build/llvm-sources/source-manifest.json", 65536],
  ...["llvm-build", "llvm-assert-build"].flatMap((name) => [
    [`/build/${name}/CMakeCache.txt`, MB],
    [`/build/${name}/compile_commands.json`, 64 * MB],
    [`/build/${name}/include/llvm/Config/llvm-config.h`, MB],
    [`/build/${name}/include/llvm/Config/abi-breaking.h`, MB],
  ]),
  ["/build/llvm-assertion-partitions.json", 4 * MB],
  ...[
    "llvm-early-abi.json",
    "llvm-abi.json",
    "llvm-stripped-abi.json",
    "llvm-release-configuration.json",
    "llvm-assertions-configuration.json",
    "llvm-build-graphs.json",
    "llvm-arm-unit-fixture-proof.json",
    "llvm-final-unit-gates.json",
  ].map((name) => ["/build/" + name, FINAL_LIMITS.receipt]),
  ["/build/llvm-arm-baseline.txt", 4096],
  ["/build/llvm-arm-candidate.txt", 4096],
  ["/build/libllvm19_19.1.7-3+vaettir1_amd64.deb", FINAL_LIMITS.package],
]);
const fixedHashes = new Set([
  "/build/llvm-baseline-library",
  "/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1",
  "/usr/lib/llvm-19/bin/clang",
  "/build/llvm-arm-policy",
  "/build/llvm-cpu-jit",
  "/build/llvm-source/llvm/unittests/TargetParser/TargetParserTest.cpp",
  "/build/llvm-source/debian/patches/930008-arm.diff",
  "/build/llvm-source/debian/patches/arm32-defaults.diff",
]);

function crc32(raw) {
  let crc = 0xffffffff;
  for (const byte of raw) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Single complete gzip member; do not silently accept trailing/concatenated
// streams. Optional headers are bounded and header CRC is checked when present.
export function decodeFinalGzip(raw, max) {
  bounded(raw, FINAL_LIMITS.package);
  safeInteger(max, 1, FINAL_LIMITS.expandedArchive);
  assert.ok(
    raw.length >= 18 && raw[0] === 31 && raw[1] === 139 && raw[2] === 8,
  );
  const flags = raw[3];
  assert.equal(flags & 224, 0);
  let offset = 10;
  if (flags & 4) {
    assert.ok(offset + 2 < raw.length);
    const size = raw.readUInt16LE(offset);
    offset += size + 2;
    assert.ok(offset <= raw.length - 8 && offset <= 65536);
  }
  for (const bit of [8, 16])
    if (flags & bit) {
      const end = raw.indexOf(0, offset);
      assert.ok(end >= offset && end < raw.length - 8 && end < 65536);
      offset = end + 1;
    }
  if (flags & 2) {
    assert.ok(offset + 2 <= raw.length - 8);
    assert.equal(
      raw.readUInt16LE(offset),
      crc32(raw.subarray(0, offset)) & 65535,
    );
    offset += 2;
  }
  const result = inflateRawSync(raw.subarray(offset), {
    maxOutputLength: max,
    info: true,
  });
  const end = offset + result.engine.bytesWritten;
  assert.equal(end + 8, raw.length, "Trailing or concatenated gzip refused");
  assert.equal(raw.readUInt32LE(end), crc32(result.buffer));
  assert.equal(raw.readUInt32LE(end + 4), result.buffer.length >>> 0);
  return bounded(result.buffer, max);
}

// Independently bound one XZ stream from its CRC-protected Index/footer before
// invoking the installed decompressor. The decompressor validates block checks;
// this gate rejects concatenated streams/padding and preflights decoded bytes.
export function validateFinalXzFrame(raw, max) {
  bounded(raw, FINAL_LIMITS.package);
  safeInteger(max, 1, FINAL_LIMITS.expandedArchive);
  assert.ok(
    raw.length >= 32 &&
      raw.subarray(0, 6).toString("hex") === "fd377a585a00" &&
      raw.subarray(-2).toString() === "YZ",
  );
  assert.equal(raw[6], 0);
  assert.ok([1, 4, 10].includes(raw[7]), "Checksummed XZ stream required");
  assert.equal(raw.readUInt32LE(8), crc32(raw.subarray(6, 8)));
  const footer = raw.subarray(-12);
  assert.equal(footer.readUInt32LE(0), crc32(footer.subarray(4, 10)));
  assert.deepEqual(footer.subarray(8, 10), raw.subarray(6, 8));
  const indexBytes = (footer.readUInt32LE(4) + 1) * 4;
  safeInteger(indexBytes, 8, 65536);
  assert.ok(indexBytes <= raw.length - 24);
  const start = raw.length - 12 - indexBytes,
    index = raw.subarray(start, start + indexBytes);
  assert.equal(index[0], 0);
  assert.equal(
    index.readUInt32LE(index.length - 4),
    crc32(index.subarray(0, -4)),
  );
  let offset = 1;
  const vli = () => {
    let value = 0,
      factor = 1;
    for (let i = 0; i < 9; i++) {
      assert.ok(offset < index.length - 4);
      const byte = index[offset++];
      value += (byte & 127) * factor;
      assert.ok(Number.isSafeInteger(value));
      if (!(byte & 128)) {
        assert.ok(i === 0 || (byte & 127) !== 0, "Canonical XZ VLI required");
        return value;
      }
      factor *= 128;
    }
    throw Error("Oversized XZ VLI");
  };
  const count = vli();
  safeInteger(count, 1, 4096);
  let packed = 0,
    unpacked = 0;
  for (let i = 0; i < count; i++) {
    const size = vli(),
      expanded = vli();
    safeInteger(size, 5, FINAL_LIMITS.package);
    safeInteger(expanded, 0, max);
    packed += Math.ceil(size / 4) * 4;
    unpacked += expanded;
    safeInteger(unpacked, 1, max);
  }
  assert.ok(index.subarray(offset, -4).every((byte) => byte === 0));
  assert.equal(start, 12 + packed, "Only one complete XZ stream permitted");
  return { blocks: count, bytes: unpacked };
}

/** Explicitly invoked only by reviewed Linux transport. All dependency injection
 * is a TEST/TRUSTED TRANSPORT boundary, never values/functions from a client.
 * Returned ops have the committed verifier's exact shape. cleanupOwnedExtraction
 * is separate so verified ACK/proof and cleanup failure cannot become a retry.
 * This constructor/adapter does not confer native/runtime/image acceptance. */
export async function createNativeFreshFinalAdapter(
  options,
  injected = defaults,
) {
  let adapterCheck = "options";
  try {
  exact(options, [
    "verificationId",
    "scriptPins",
    "probePins",
    "finalLog",
    "finalLogSha256",
    "deadlineMs",
    "cleanupDeadlineMs",
    "memoryLimitBytes",
    "exclusiveWriter",
  ]);
  exact(injected, [
    "fs",
    "exec",
    "importExact",
    "clock",
    "platform",
    "uid",
    "memory",
  ]);
  assert.match(options.verificationId, HEX);
  assert.match(options.finalLogSha256, HEX);
  exact(options.scriptPins, scripts);
  for (const value of Object.values(options.scriptPins))
    assert.match(value, HEX);
  exact(options.probePins, ["llvm-arm-policy", "llvm-cpu-jit"]);
  for (const value of Object.values(options.probePins))
    assert.match(value, HEX);
  options = {
    ...options,
    scriptPins: { ...options.scriptPins },
    probePins: { ...options.probePins },
    finalLog: Buffer.from(bounded(options.finalLog, FINAL_LIMITS.log)),
  };
  assert.equal(
    options.exclusiveWriter,
    true,
    "Exclusive container writer required; transport must enforce it",
  );
  adapterCheck = "platform-identity";
  assert.equal(injected.platform(), "linux");
  assert.equal(injected.uid(), 0);
  safeInteger(options.memoryLimitBytes, 4 * GB, 14 * GB);
  adapterCheck = "deadline";
  assert.ok(
    Number.isFinite(options.deadlineMs) &&
      Number.isFinite(options.cleanupDeadlineMs),
  );
  const initial = injected.clock();
  assert.ok(
    options.deadlineMs > initial && options.deadlineMs - initial <= 2520000,
  );
  assert.ok(
    options.cleanupDeadlineMs >= options.deadlineMs &&
      options.cleanupDeadlineMs <= options.deadlineMs + 75000,
  );
  adapterCheck = "memory-read";
  const memory = injected.memory();
  adapterCheck = "memory-admission";
  exact(memory, ["limit", "used"]);
  safeInteger(memory.limit, 4 * GB, 14 * GB);
  safeInteger(memory.used, 0, memory.limit);
  assert.equal(memory.limit, options.memoryLimitBytes);
  assert.ok(
    memory.limit - memory.used >= 2 * GB,
    "Insufficient package/ELF memory admission",
  );
  adapterCheck = "final-log-hash";
  const finalLog = Buffer.from(bounded(options.finalLog, FINAL_LIMITS.log));
  assert.equal(hash(finalLog), options.finalLogSha256);
  const io = injected.fs;
  adapterCheck = "filesystem-capability";
  assert.ok(
    Number.isSafeInteger(io.constants.O_NOFOLLOW) &&
      io.constants.O_NOFOLLOW > 0,
    "Linux no-follow capability required",
  );
  const root = "/tmp/vaettir-fresh-final-" + options.verificationId;
  let ownedRoot = null,
    created = new Map(),
    manifest = null,
    cleaned = false;
  let lastClock = initial;
  const check = (cleanup = false) => {
    const now = injected.clock();
    assert.ok(
      Number.isFinite(now) && now >= lastClock,
      "Monotonic clock required",
    );
    lastClock = now;
    assert.ok(
      now < (cleanup ? options.cleanupDeadlineMs : options.deadlineMs),
      "Native verification deadline exhausted",
    );
    return Math.max(
      1,
      Math.floor(
        (cleanup ? options.cleanupDeadlineMs : options.deadlineMs) - now,
      ),
    );
  };
  function ancestors(path) {
    assert.ok(
      path.startsWith("/") &&
        posix.normalize(path) === path &&
        !path.includes("\0"),
    );
    const result = [];
    for (let parent = posix.dirname(path); ; parent = posix.dirname(parent)) {
      const stat = io.lstatSync(parent);
      assert.ok(
        stat.isDirectory() &&
          !stat.isSymbolicLink() &&
          io.realpathSync(parent) === parent,
        "Aliased/non-directory ancestor refused",
      );
      result.push([parent, objectId(stat)]);
      if (parent === "/") break;
    }
    return result;
  }
  function assertAncestors(original) {
    for (const [path, identity] of original)
      assert.deepEqual(
        objectId(io.lstatSync(path)),
        identity,
        "Ancestor changed during operation",
      );
  }
  function regular(path, max, readBytes) {
    check();
    safeInteger(max, 1, FINAL_LIMITS.identityFile);
    const parents = ancestors(path),
      before = io.lstatSync(path);
    assert.ok(before.isFile() && !before.isSymbolicLink());
    safeInteger(before.size, 0, max);
    const fd = io.openSync(
      path,
      io.constants.O_RDONLY | io.constants.O_NOFOLLOW,
    );
    try {
      const opened = io.fstatSync(fd);
      assert.ok(opened.isFile());
      assert.deepEqual(statId(opened), statId(before));
      const chunks = [],
        digest = createHash("sha256"),
        chunk = Buffer.allocUnsafe(Math.min(MB, max));
      let bytes = 0,
        count;
      while ((count = io.readSync(fd, chunk, 0, chunk.length, null))) {
        check();
        bytes += count;
        assert.ok(
          bytes <= max && bytes <= before.size,
          "File grew while reading",
        );
        digest.update(chunk.subarray(0, count));
        if (readBytes) chunks.push(Buffer.from(chunk.subarray(0, count)));
      }
      assert.equal(bytes, before.size);
      assert.deepEqual(statId(io.fstatSync(fd)), statId(before));
      assert.deepEqual(statId(io.lstatSync(path)), statId(before));
      assertAncestors(parents);
      check();
      return readBytes
        ? Buffer.concat(chunks, bytes)
        : { sha256: digest.digest("hex"), bytes };
    } finally {
      io.closeSync(fd);
    }
  }
  const extractedLibrary = root + "/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1";
  function read(path, max) {
    assert.ok(fixedReads.has(path));
    safeInteger(max, 1, fixedReads.get(path));
    return regular(path, max, true);
  }
  function hashFile(path, max) {
    assert.ok(
      fixedHashes.has(path) || (ownedRoot && path === extractedLibrary),
    );
    return regular(path, max, false);
  }
  function exists(path) {
    check();
    assert.ok(path === "/build/llvm-phase-active.json" || path === root);
    const parents = ancestors(path);
    try {
      io.lstatSync(path);
      assertAncestors(parents);
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      assertAncestors(parents);
      return false;
    }
  }
  function list(path) {
    check();
    assert.ok(
      path === "/build/scripts" || path === "/build/llvm-phase-receipts",
    );
    const parents = ancestors(path),
      before = io.lstatSync(path);
    assert.ok(
      before.isDirectory() &&
        !before.isSymbolicLink() &&
        io.realpathSync(path) === path,
    );
    const names = io.readdirSync(path);
    assert.ok(
      names.length <= 32 &&
        names.every(
          (name) =>
            typeof name === "string" &&
            name.length <= 128 &&
            !name.includes("/") &&
            !name.includes("\0"),
        ),
    );
    assert.deepEqual(statId(io.lstatSync(path)), statId(before));
    assertAncestors(parents);
    check();
    return names;
  }
  function executable(path) {
    const permitted = {
      "/usr/bin/clang++-19": [
        "/usr/bin/clang++-19",
        "/usr/lib/llvm-19/bin/clang",
      ],
      "/usr/bin/dpkg-query": ["/usr/bin/dpkg-query"],
      "/usr/bin/readelf": [
        "/usr/bin/readelf",
        "/usr/bin/x86_64-linux-gnu-readelf",
      ],
      "/usr/bin/nm": ["/usr/bin/nm", "/usr/bin/x86_64-linux-gnu-nm"],
      "/usr/bin/xz": ["/usr/bin/xz"],
    };
    const resolved = io.realpathSync(path);
    assert.ok(
      permitted[path]?.includes(resolved),
      "Unexpected maintained executable target",
    );
    ancestors(resolved);
    const stat = io.lstatSync(resolved);
    assert.ok(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.mode & 0o111 &&
        !(stat.mode & 0o022) &&
        stat.uid === 0,
    );
    return { path: resolved, identity: statId(stat) };
  }
  function command(path, args, max, timeout = 30000, input) {
    check();
    assert.ok(
      [
        "/usr/bin/clang++-19",
        "/usr/bin/dpkg-query",
        "/usr/bin/readelf",
        "/usr/bin/nm",
        "/usr/bin/xz",
      ].includes(path),
    );
    assert.ok(
      Array.isArray(args) &&
        args.every(
          (arg) =>
            typeof arg === "string" &&
            arg.length <= 4096 &&
            !arg.includes("\0"),
        ),
    );
    const bin = executable(path),
      before = ancestors(bin.path);
    const result = injected.exec(bin.path, args, {
      encoding: "buffer",
      timeout: Math.min(timeout, check()),
      killSignal: "SIGKILL",
      maxBuffer: max,
      env: environment,
      cwd: "/",
      ...(input === undefined ? {} : { input }),
    });
    assert.deepEqual(statId(io.lstatSync(bin.path)), bin.identity);
    assertAncestors(before);
    check();
    return bounded(result, max);
  }
  function compiler() {
    return {
      compilerSha256: hashFile(
        "/usr/lib/llvm-19/bin/clang",
        FINAL_LIMITS.identityFile,
      ).sha256,
      compiler: new TextDecoder("utf-8", { fatal: true }).decode(
        command("/usr/bin/clang++-19", ["--version"], 8 * MB),
      ),
      compilerPackage: command(
        "/usr/bin/dpkg-query",
        ["-W", "-f=${Version}", "clang-19"],
        8 * MB,
      )
        .toString("utf8")
        .trim(),
      installedPackagesSha256: hash(
        command(
          "/usr/bin/dpkg-query",
          ["-W", "-f=${Package}\t${Version}\t${Architecture}\n"],
          8 * MB,
        ),
      ),
    };
  }
  function resolveCandidate(path) {
    const libraryDirs = [
      "/build/llvm-build/lib",
      root + "/usr/lib/x86_64-linux-gnu",
    ];
    assert.ok(
      path === "/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1" ||
        path === "/build/llvm-build/lib/libLLVM.so.19.1" ||
        (ownedRoot && path === extractedLibrary),
    );
    const dir = posix.dirname(path),
      seen = new Set(),
      snapshots = [];
    ancestors(path);
    for (;;) {
      assert.ok(!seen.has(path) && seen.size < 16);
      seen.add(path);
      const stat = io.lstatSync(path);
      snapshots.push([path, statId(stat)]);
      if (!stat.isSymbolicLink()) {
        assert.ok(stat.isFile());
        return { path, snapshots };
      }
      assert.ok(libraryDirs.includes(dir), "Baseline must be regular");
      const target = io.readlinkSync(path);
      assert.ok(typeof target === "string" && target.length <= 4096);
      const next = posix.resolve(dir, target);
      assert.ok(
        (posix.isAbsolute(target) || target === posix.basename(target)) &&
          !target.split("/").includes("..") &&
          posix.dirname(next) === dir &&
          /^libLLVM\.so(?:\.[0-9]+){0,3}$/.test(posix.basename(next)),
      );
      path = next;
    }
  }
  function inspectElf(path) {
    check();
    const resolved = resolveCandidate(path),
      digest = regular(resolved.path, FINAL_LIMITS.identityFile, false);
    const dynamic = new TextDecoder("utf-8", { fatal: true }).decode(
      command("/usr/bin/readelf", ["-d", resolved.path], 32 * MB),
    );
    const sonames = [...dynamic.matchAll(/\(SONAME\).*\[([^\]]+)\]/g)];
    assert.equal(sonames.length, 1);
    const symbols = new TextDecoder("utf-8", { fatal: true }).decode(
      command(
        "/usr/bin/nm",
        ["-D", "--defined-only", "--format=posix", resolved.path],
        32 * MB,
      ),
    );
    assert.deepEqual(
      regular(resolved.path, FINAL_LIMITS.identityFile, false),
      digest,
    );
    for (const [name, identity] of resolved.snapshots)
      assert.deepEqual(statId(io.lstatSync(name)), identity);
    return {
      sha256: digest.sha256,
      soname: sonames[0][1],
      needed: [...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)].map(
        (match) => match[1],
      ),
      symbols,
    };
  }
  function inspectDynamic(path) {
    assert.ok(
      path === "/build/llvm-arm-policy" || path === "/build/llvm-cpu-jit",
    );
    const before = regular(path, FINAL_LIMITS.identityFile, false);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(
      command("/usr/bin/readelf", ["-d", path], 32 * MB),
    );
    const attribute = (name) => {
      const hits = [
        ...raw.matchAll(new RegExp("\\(" + name + "\\).*\\[([^\\]]*)\\]", "g")),
      ];
      assert.ok(hits.length <= 1);
      return hits[0]?.[1] ?? null;
    };
    assert.deepEqual(regular(path, FINAL_LIMITS.identityFile, false), before);
    return {
      needed: [...raw.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)].map(
        (match) => match[1],
      ),
      rpath: attribute("RPATH"),
      runpath: attribute("RUNPATH"),
    };
  }
  function decode(kind, raw, max) {
    check();
    bounded(raw, FINAL_LIMITS.package);
    safeInteger(max, 1, FINAL_LIMITS.expandedArchive);
    let result;
    if (kind === "gz") result = decodeFinalGzip(raw, max);
    else if (kind === "xz") {
      const shape = validateFinalXzFrame(raw, max);
      result = command(
        "/usr/bin/xz",
        ["--decompress", "--stdout", "--memlimit-decompress=256MiB"],
        max,
        30000,
        raw,
      );
      assert.equal(result.length, shape.bytes);
    } else
      throw Error(
        "Unsupported Zstandard/unknown decompression capability; no automatic install",
      );
    check();
    return bounded(result, max);
  }
  function rootIdentity(cleanup = false) {
    check(cleanup);
    assert.ok(ownedRoot && !cleaned);
    assert.deepEqual(objectId(io.lstatSync(root)), ownedRoot);
    assert.equal(io.realpathSync(root), root);
    return ancestors(root);
  }
  function privateInventory(cleanup = false) {
    rootIdentity(cleanup);
    const entries = [],
      walk = (dir) => {
        const names = io.readdirSync(dir).sort();
        assert.ok(entries.length + names.length <= FINAL_LIMITS.packageEntries);
        for (const name of names) {
          assert.ok(
            name &&
              name === posix.basename(name) &&
              ![".", ".."].includes(name),
          );
          const path = dir + "/" + name,
            rel = posix.relative(root, path),
            stat = io.lstatSync(path);
          assert.equal(stat.dev, ownedRoot.dev);
          assert.equal(stat.uid, 0);
          if (stat.isDirectory() && !stat.isSymbolicLink()) {
            entries.push({
              path: rel,
              kind: "directory",
              bytes: 0,
              mode: stat.mode & 0o7777,
              linkTarget: null,
              sha256: null,
            });
            walk(path);
          } else if (stat.isSymbolicLink())
            entries.push({
              path: rel,
              kind: "symlink",
              bytes: 0,
              mode: stat.mode & 0o7777,
              linkTarget: io.readlinkSync(path),
              sha256: null,
            });
          else {
            assert.ok(stat.isFile());
            entries.push({
              path: rel,
              kind: "file",
              bytes: stat.size,
              mode: stat.mode & 0o7777,
              linkTarget: null,
              sha256: cleanup
                ? null
                : regular(path, FINAL_LIMITS.packageFile, false).sha256,
            });
          }
        }
      };
    walk(root);
    assert.ok(entries.length <= FINAL_LIMITS.packageEntries);
    return entries;
  }
  function extract(raw, requestedRoot, entries) {
    check();
    assert.equal(requestedRoot, root);
    assert.ok(!ownedRoot && !cleaned);
    assert.equal(exists(root), false);
    const parsed = inspectFinalDebianPackage(raw, decode);
    assert.deepEqual(parsed.entries, entries);
    const dirs = new Set(
      entries
        .filter((entry) => entry.kind === "directory")
        .map((entry) => entry.path),
    );
    for (const entry of entries)
      for (
        let parent = posix.dirname(entry.path);
        parent !== ".";
        parent = posix.dirname(parent)
      )
        assert.ok(
          dirs.has(parent),
          "Package must declare every parent directory",
        );
    const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    safeInteger(total, 1, FINAL_LIMITS.expandedArchive);
    const disk = io.statfsSync("/tmp");
    assert.ok(
      Number.isSafeInteger(disk.bavail) && Number.isSafeInteger(disk.bsize),
    );
    assert.ok(
      disk.bavail * disk.bsize >= total + 64 * MB,
      "Insufficient exclusive extraction disk admission",
    );
    const parents = ancestors(root);
    io.mkdirSync(root, { mode: 0o700 });
    const rootStat = io.lstatSync(root);
    assert.ok(
      rootStat.isDirectory() &&
        !rootStat.isSymbolicLink() &&
        rootStat.uid === 0 &&
        rootStat.dev === io.lstatSync("/tmp").dev,
    );
    ownedRoot = objectId(rootStat);
    assertAncestors(parents);
    for (const entry of [...entries].sort(
      (a, b) =>
        a.path.split("/").length - b.path.split("/").length ||
        a.path.localeCompare(b.path),
    )) {
      if (entry.kind === "symlink") continue;
      rootIdentity();
      const path = root + "/" + entry.path,
        before = ancestors(path);
      if (entry.kind === "directory") io.mkdirSync(path, { mode: entry.mode });
      else {
        const content = parsed.contents.get(entry.path);
        assert.equal(content.length, entry.bytes);
        assert.equal(hash(content), entry.sha256);
        const fd = io.openSync(
          path,
          io.constants.O_WRONLY |
            io.constants.O_CREAT |
            io.constants.O_EXCL |
            io.constants.O_NOFOLLOW,
          0o600,
        );
        try {
          const stat = io.fstatSync(fd);
          assert.ok(
            stat.isFile() && stat.dev === ownedRoot.dev && stat.uid === 0,
          );
          created.set(path, objectId(stat));
          let offset = 0;
          while (offset < content.length) {
            check();
            const written = io.writeSync(
              fd,
              content,
              offset,
              Math.min(MB, content.length - offset),
              null,
            );
            assert.ok(written > 0);
            offset += written;
          }
          io.fchmodSync(fd, entry.mode);
        } finally {
          created.set(path, statId(io.fstatSync(fd)));
          io.closeSync(fd);
        }
      }
      const stat = io.lstatSync(path);
      assert.equal(stat.dev, ownedRoot.dev);
      assert.equal(stat.uid, 0);
      created.set(path, entry.kind === "file" ? statId(stat) : objectId(stat));
      assertAncestors(before);
    }
    for (const entry of entries.filter((entry) => entry.kind === "symlink")) {
      rootIdentity();
      const path = root + "/" + entry.path,
        before = ancestors(path);
      assert.equal(entry.linkTarget, "libLLVM.so.19.1");
      assert.ok(
        io.lstatSync(posix.dirname(path) + "/" + entry.linkTarget).isFile(),
      );
      io.symlinkSync(entry.linkTarget, path);
      created.set(path, objectId(io.lstatSync(path)));
      assertAncestors(before);
    }
    const actual = privateInventory(),
      sorted = (list) => [...list].sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(sorted(actual), sorted(entries));
    manifest = entries.map((entry) => ({ ...entry }));
    return manifest.map((entry) => ({ ...entry }));
  }
  function runProbe(request) {
    exact(request, [
      "loader",
      "libraryDirectory",
      "path",
      "timeoutSeconds",
      "outputMax",
      "environment",
    ]);
    rootIdentity();
    assert.equal(request.loader, "/lib64/ld-linux-x86-64.so.2");
    assert.equal(request.libraryDirectory, root + "/usr/lib/x86_64-linux-gnu");
    assert.ok(
      request.path === "/build/llvm-arm-policy" ||
        request.path === "/build/llvm-cpu-jit",
    );
    assert.equal(request.timeoutSeconds, 10);
    assert.equal(
      request.outputMax,
      request.path.endsWith("cpu-jit") ? 256 : 4096,
    );
    assert.deepEqual(request.environment, {
      PATH: "/usr/bin:/bin",
      LC_ALL: "C",
    });
    const before = regular(request.path, FINAL_LIMITS.identityFile, false),
      library = regular(extractedLibrary, FINAL_LIMITS.packageFile, false);
    assert.equal(
      before.sha256,
      options.probePins[posix.basename(request.path)],
      "Authored probe bytes not pinned",
    );
    assert.ok(
      manifest &&
        manifest.some(
          (entry) =>
            entry.path === posix.relative(root, extractedLibrary) &&
            entry.sha256 === library.sha256,
        ),
    );
    const loader = io.realpathSync(request.loader);
    assert.ok(
      loader === "/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2" ||
        loader === "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2",
    );
    ancestors(loader);
    const loaderBefore = statId(io.lstatSync(loader));
    assert.ok(
      io.lstatSync(loader).isFile() &&
        io.lstatSync(loader).uid === 0 &&
        !(io.lstatSync(loader).mode & 0o022) &&
        io.lstatSync(loader).mode & 0o111,
    );
    const result = injected.exec(
      loader,
      ["--library-path", request.libraryDirectory, request.path],
      {
        encoding: "buffer",
        timeout: Math.min(10000, check()),
        killSignal: "SIGKILL",
        maxBuffer: request.outputMax,
        env: { ...request.environment, LANG: "C", HOME: "/nonexistent" },
        cwd: root,
      },
    );
    assert.deepEqual(statId(io.lstatSync(loader)), loaderBefore);
    assert.deepEqual(
      regular(request.path, FINAL_LIMITS.identityFile, false),
      before,
    );
    assert.deepEqual(
      regular(extractedLibrary, FINAL_LIMITS.packageFile, false),
      library,
    );
    rootIdentity();
    return bounded(result, request.outputMax);
  }
  async function original(name, allowedImports) {
    const diagnosticPrefix = name === "native-llvm-checkpoint.mjs" ? "checkpoint" : "abi";
    adapterCheck = diagnosticPrefix === "checkpoint" ? "checkpoint-read" : "abi-read";
    const raw = read("/build/scripts/" + name, MB);
    adapterCheck = diagnosticPrefix === "checkpoint" ? "checkpoint-hash" : "abi-hash";
    assert.equal(
      hash(raw),
      options.scriptPins[name],
      "Original module bytes not pinned",
    );
    adapterCheck = diagnosticPrefix === "checkpoint" ? "checkpoint-import-scope" : "abi-import-scope";
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const imports = [
      ...text.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g),
    ].map((match) => match[1]);
    assert.ok(
      imports.length > 0 &&
        imports.every((specifier) => allowedImports.includes(specifier)),
      "Only original builtin module imports permitted",
    );
    adapterCheck = diagnosticPrefix === "checkpoint" ? "checkpoint-import" : "abi-import";
    const exports = await injected.importExact(
      "data:text/javascript;base64," + raw.toString("base64"),
    );
    adapterCheck = diagnosticPrefix === "checkpoint" ? "checkpoint-rehash" : "abi-rehash";
    check();
    assert.equal(
      hash(read("/build/scripts/" + name, MB)),
      options.scriptPins[name],
    );
    return exports;
  }
  const checkpoint = await original("native-llvm-checkpoint.mjs", [
    "node:assert/strict",
    "node:crypto",
    "node:child_process",
    "node:fs",
    "node:path",
    "node:url",
  ]);
  const packageModule = await original("check-llvm-package.mjs", [
    "node:child_process",
    "node:crypto",
    "node:fs",
    "node:url",
  ]);
  adapterCheck = "checkpoint-exports";
  for (const name of ["inventoryTree", "hashCandidateLibrary"])
    assert.equal(typeof checkpoint[name], "function");
  adapterCheck = "abi-exports";
  assert.equal(typeof packageModule.verifyLlvmCompatibility, "function");
  const native = {
    inventoryTree(path, limits) {
      assert.ok(
        [
          "/build/scripts",
          "/build/llvm-sources",
          "/build/llvm-source",
          "/build/llvm-build",
          "/build/llvm-assert-build",
        ].includes(path),
      );
      exact(
        limits,
        path === "/build/llvm-source"
          ? ["maxFiles", "maxBytes", "exclude"]
          : ["maxFiles", "maxBytes"],
      );
      assert.equal(limits.maxFiles, FINAL_LIMITS.files);
      assert.equal(limits.maxBytes, FINAL_LIMITS.inventoryBytes);
      if (path === "/build/llvm-source")
        assert.deepEqual(limits.exclude, [
          "debian/libllvm19",
          "debian/libllvm19.substvars",
        ]);
      check();
      const before = ancestors(path),
        stat = io.lstatSync(path);
      assert.ok(
        stat.isDirectory() &&
          !stat.isSymbolicLink() &&
          io.realpathSync(path) === path,
      );
      const result = checkpoint.inventoryTree(path, limits);
      assert.deepEqual(objectId(io.lstatSync(path)), objectId(stat));
      assertAncestors(before);
      check();
      return result;
    },
    hashCandidateLibrary(path, phase, limits) {
      assert.equal(path, "/build");
      assert.ok(phase === "release-core" || phase === "final");
      exact(limits, ["maxBytes"]);
      assert.equal(limits.maxBytes, FINAL_LIMITS.identityFile);
      check();
      const result = checkpoint.hashCandidateLibrary(path, phase, limits);
      check();
      return result;
    },
    verifyLlvmCompatibility(baseline, candidate) {
      check();
      const result = packageModule.verifyLlvmCompatibility(baseline, candidate);
      check();
      return result;
    },
  };
  const ops = {
    read,
    list,
    exists,
    hashFile,
    compiler,
    native,
    inspectElf,
    inspectDynamic,
    decode,
    extract,
    runProbe,
    readFinalLog(max) {
      check();
      safeInteger(max, 1, FINAL_LIMITS.log);
      assert.ok(finalLog.length <= max);
      assert.equal(hash(finalLog), options.finalLogSha256);
      return Buffer.from(finalLog);
    },
  };
  function cleanupOwnedExtraction() {
    check(true);
    if (!ownedRoot || cleaned) return { removed: false };
    rootIdentity(true);
    const actual = privateInventory(true);
    assert.equal(actual.length, created.size);
    for (const entry of actual) {
      const path = root + "/" + entry.path;
      assert.ok(created.has(path));
      assert.deepEqual(
        entry.kind === "file"
          ? statId(io.lstatSync(path))
          : objectId(io.lstatSync(path)),
        created.get(path),
        "Cleanup identity changed; retain unrelated path",
      );
    }
    for (const [path, identity] of [...created].sort(
      (a, b) =>
        b[0].split("/").length - a[0].split("/").length ||
        b[0].localeCompare(a[0]),
    )) {
      rootIdentity(true);
      const stat = io.lstatSync(path);
      assert.deepEqual(stat.isFile() ? statId(stat) : objectId(stat), identity);
      if (stat.isDirectory() && !stat.isSymbolicLink()) io.rmdirSync(path);
      else io.unlinkSync(path);
    }
    rootIdentity(true);
    assert.deepEqual(io.readdirSync(root), []);
    io.rmdirSync(root);
    cleaned = true;
    created = new Map();
    return { removed: true };
  }
  return Object.freeze({
    ops: Object.freeze(ops),
    cleanupOwnedExtraction,
    provenance: Object.freeze({
      verificationId: options.verificationId,
      checkpointModuleSha256: options.scriptPins["native-llvm-checkpoint.mjs"],
      abiModuleSha256: options.scriptPins["check-llvm-package.mjs"],
      finalLogSha256: options.finalLogSha256,
      exclusiveWriterRequired: true,
      outerWatchdogRequired: true,
      memoryLimitBytes: memory.limit,
      zstandardSupported: false,
      runtimeAcceptance: false,
      authenticatedAcceptance: false,
      deploymentAcceptance: false,
    }),
  });
  } catch (error) {
    // Own data only, never inspect or invoke the thrown object's properties.
    // Annotation failure cannot replace the original rejection/exception.
    try {
      Object.defineProperty(error, "nativeFinalAdapterCheck", {
        value: adapterCheck,
        configurable: true,
        enumerable: false,
        writable: false,
      });
    } catch {}
    throw error;
  }
}
