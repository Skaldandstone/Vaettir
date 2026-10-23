// Synthetic injected IO/subprocess/modules ONLY. Never invokes default Linux
// dependencies, native probes, a real filesystem, shell, Docker, AWS or Git.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { posix } from "node:path";
import {
  createNativeFreshFinalAdapter,
  decodeFinalGzip,
  validateFinalXzFrame,
} from "./native-builder-fresh-final-adapter.mjs";
import {
  inspectFinalDebianPackage,
  FINAL_LIMITS,
} from "./native-builder-fresh-final-verifier.mjs";

const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const GB = 1024 ** 3,
  MB = 1024 ** 2;
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
];
function virtualFs() {
  const nodes = new Map(),
    fds = new Map(),
    calls = [];
  let nextInode = 1,
    nextFd = 100;
  const error = (code) => Object.assign(Error("Synthetic " + code), { code });
  const add = (path, kind, raw, mode) => {
    const node = {
      kind,
      raw: Buffer.isBuffer(raw)
        ? Buffer.from(raw)
        : kind === "file"
          ? Buffer.from(raw ?? "")
          : raw,
      mode:
        mode ??
        (kind === "directory" ? 0o755 : kind === "symlink" ? 0o777 : 0o644),
      ino: nextInode++,
      dev: 1,
      uid: 0,
      mtimeMs: 1,
      ctimeMs: 1,
    };
    nodes.set(path, node);
    return node;
  };
  add("/", "directory");
  const directory = (path) => {
    if (path !== "/") directory(posix.dirname(path));
    if (!nodes.has(path)) add(path, "directory");
  };
  const file = (path, raw, mode) => {
    directory(posix.dirname(path));
    return add(path, "file", raw, mode);
  };
  const get = (path) => {
    if (!nodes.has(path)) throw error("ENOENT");
    return nodes.get(path);
  };
  const stat = (node) => ({
    dev: node.dev,
    ino: node.ino,
    uid: node.uid,
    mode:
      node.mode +
      (node.kind === "file"
        ? 0o100000
        : node.kind === "directory"
          ? 0o40000
          : 0o120000),
    size: node.kind === "file" ? node.raw.length : 0,
    mtimeMs: node.mtimeMs,
    ctimeMs: node.ctimeMs,
    isFile: () => node.kind === "file",
    isDirectory: () => node.kind === "directory",
    isSymbolicLink: () => node.kind === "symlink",
  });
  const io = {
    constants: {
      O_RDONLY: 0,
      O_WRONLY: 1,
      O_CREAT: 64,
      O_EXCL: 128,
      O_NOFOLLOW: 131072,
    },
    lstatSync(path) {
      calls.push(["lstat", path]);
      return stat(get(path));
    },
    realpathSync(path) {
      const node = get(path);
      return node.kind === "symlink"
        ? io.realpathSync(posix.resolve(posix.dirname(path), node.raw))
        : path;
    },
    readdirSync(path) {
      assert.equal(get(path).kind, "directory");
      return [...nodes.keys()]
        .filter((key) => key !== path && posix.dirname(key) === path)
        .map((key) => posix.basename(key));
    },
    openSync(path, flags, mode) {
      calls.push(["open", path, flags]);
      if (flags & 64) {
        if (nodes.has(path) && flags & 128) throw error("EEXIST");
        assert.equal(get(posix.dirname(path)).kind, "directory");
        add(path, "file", Buffer.alloc(0), mode);
      }
      const node = get(path);
      if (node.kind === "symlink" && flags & 131072) throw error("ELOOP");
      assert.equal(node.kind, "file");
      const fd = nextFd++;
      fds.set(fd, { node, path, offset: 0 });
      return fd;
    },
    fstatSync(fd) {
      return stat(fds.get(fd).node);
    },
    readSync(fd, target, offset, length) {
      const data = fds.get(fd);
      const count = Math.min(length, data.node.raw.length - data.offset);
      data.node.raw.copy(target, offset, data.offset, data.offset + count);
      data.offset += count;
      if (io.onRead) io.onRead(data);
      return count;
    },
    closeSync(fd) {
      calls.push(["close", fd]);
      assert.ok(fds.delete(fd));
    },
    readlinkSync(path) {
      const node = get(path);
      assert.equal(node.kind, "symlink");
      return node.raw;
    },
    mkdirSync(path, { mode }) {
      calls.push(["mkdir", path]);
      if (nodes.has(path)) throw error("EEXIST");
      assert.equal(get(posix.dirname(path)).kind, "directory");
      add(path, "directory", null, mode);
    },
    writeSync(fd, raw, offset, length) {
      if (io.failWrite) throw Error("Synthetic write failure");
      const data = fds.get(fd);
      data.node.raw = Buffer.concat([
        data.node.raw,
        raw.subarray(offset, offset + length),
      ]);
      return length;
    },
    fchmodSync(fd, mode) {
      fds.get(fd).node.mode = mode;
    },
    symlinkSync(target, path) {
      calls.push(["symlink", path]);
      assert.ok(!nodes.has(path));
      assert.equal(get(posix.dirname(path)).kind, "directory");
      add(path, "symlink", target);
    },
    statfsSync(path) {
      assert.equal(path, "/tmp");
      return { bavail: 1024 ** 2, bsize: 4096 };
    },
    unlinkSync(path) {
      calls.push(["unlink", path]);
      assert.notEqual(get(path).kind, "directory");
      nodes.delete(path);
    },
    rmdirSync(path) {
      calls.push(["rmdir", path]);
      assert.equal(io.readdirSync(path).length, 0);
      assert.equal(get(path).kind, "directory");
      nodes.delete(path);
    },
  };
  return { nodes, fds, calls, io, directory, file, add };
}
function fixture() {
  const v = virtualFs();
  v.directory("/tmp");
  v.directory("/build/llvm-source");
  v.directory("/build/llvm-build/lib");
  v.directory("/build/llvm-assert-build");
  v.directory("/build/llvm-phase-receipts");
  const pins = {};
  for (const name of scripts) {
    const raw = Buffer.from(
      name === "native-llvm-checkpoint.mjs"
        ? "import fs from 'node:fs'; // synthetic checkpoint\nexport const inventoryTree = null;"
        : name === "check-llvm-package.mjs"
          ? "import fs from 'node:fs'; // synthetic package\nexport const verifyLlvmCompatibility = null;"
          : "// synthetic original " + name,
    );
    v.file("/build/scripts/" + name, raw);
    pins[name] = hash(raw);
  }
  v.file("/build/llvm-baseline-library", "baseline");
  v.file("/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1", "baseline");
  v.file("/usr/lib/llvm-19/bin/clang", "clang");
  v.file("/build/llvm-build/lib/libLLVM.so.1", "candidate");
  v.add("/build/llvm-build/lib/libLLVM.so.19.1", "symlink", "libLLVM.so.1");
  v.file("/build/llvm-arm-policy", "authored arm", 0o755);
  v.file("/build/llvm-cpu-jit", "authored jit", 0o755);
  for (const name of ["clang++-19", "dpkg-query", "readelf", "nm", "xz"])
    v.file("/usr/bin/" + name, "maintained binary", 0o755);
  v.file(
    "/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2",
    "maintained loader",
    0o755,
  );
  v.directory("/lib64");
  v.add(
    "/lib64/ld-linux-x86-64.so.2",
    "symlink",
    "/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2",
  );
  const finalLog = Buffer.from("synthetic external compiler log\n"),
    clock = { now: 1 },
    calls = [],
    nativeCalls = [];
  const options = {
    verificationId: "a".repeat(64),
    scriptPins: pins,
    probePins: {
      "llvm-arm-policy": hash(Buffer.from("authored arm")),
      "llvm-cpu-jit": hash(Buffer.from("authored jit")),
    },
    finalLog,
    finalLogSha256: hash(finalLog),
    deadlineMs: 200000,
    cleanupDeadlineMs: 275000,
    memoryLimitBytes: 4 * GB,
    exclusiveWriter: true,
  };
  const deps = {
    fs: v.io,
    clock: () => clock.now,
    platform: () => "linux",
    uid: () => 0,
    memory: () => ({ limit: 4 * GB, used: 64 * MB }),
    importExact: async (url) => {
      calls.push(["import", url]);
      assert.ok(url.startsWith("data:text/javascript;base64,"));
      const raw = Buffer.from(url.split(",")[1], "base64");
      if (raw.toString().includes("synthetic checkpoint"))
        return {
          inventoryTree: (...args) => {
            nativeCalls.push(["inventory", ...args]);
            return { sha256: "b".repeat(64), entries: 100, bytes: 1000 };
          },
          hashCandidateLibrary: (...args) => {
            nativeCalls.push(["candidate", ...args]);
            return { sha256: "c".repeat(64), bytes: 1000 };
          },
        };
      assert.ok(raw.toString().includes("synthetic package"));
      return {
        verifyLlvmCompatibility: (...args) => {
          nativeCalls.push(["abi", ...args]);
          return { synthetic: true };
        },
      };
    },
    exec: (path, args, settings) => {
      calls.push(["exec", path, args, settings]);
      if (path.endsWith("clang++-19"))
        return Buffer.from(
          "Debian clang version 19.1.7 (3+b1)\nTarget: x86_64\n",
        );
      if (path.endsWith("dpkg-query"))
        return Buffer.from(
          args[1] === "-f=${Version}"
            ? "1:19.1.7-3+b1"
            : "z-package\t1\tamd64\na-package\t2\tamd64\n",
        );
      if (path.endsWith("readelf"))
        return Buffer.from(
          " (SONAME) Library soname: [libLLVM.so.19.1]\n (NEEDED) Shared library: [libLLVM.so.19.1]\n",
        );
      if (path.endsWith("nm")) return Buffer.from("public_api T 0 4\n");
      if (path.endsWith("ld-linux-x86-64.so.2"))
        return Buffer.from(
          args[2].endsWith("cpu-jit")
            ? "VAETTIR_LLVM_CPU_JIT_ADD_4_7=11\n"
            : "synthetic33arm\n",
        );
      throw Error("Synthetic unsupported command");
    },
  };
  return { v, options, deps, clock, calls, nativeCalls };
}
function crc32(raw) {
  let value = 0xffffffff;
  for (const byte of raw) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function syntheticXz(expanded = 100) {
  assert.ok(expanded < 128);
  const header = Buffer.from("fd377a585a00000400000000", "hex");
  header.writeUInt32LE(crc32(header.subarray(6, 8)), 8);
  const index = Buffer.from([0, 1, 12, expanded, 0, 0, 0, 0]);
  index.writeUInt32LE(crc32(index.subarray(0, 4)), 4);
  const footer = Buffer.from("00000000010000000004595a", "hex");
  footer.writeUInt32LE(crc32(footer.subarray(4, 10)), 0);
  return Buffer.concat([header, Buffer.alloc(12), index, footer]);
}
function tar(entries) {
  const pieces = [];
  for (const item of entries) {
    const raw = item.raw ?? Buffer.alloc(0),
      header = Buffer.alloc(512),
      oct = (at, width, value) =>
        header.write(
          value.toString(8).padStart(width - 1, "0") + "\0",
          at,
          width,
          "ascii",
        );
    header.write(item.path, 0, 100);
    oct(
      100,
      8,
      item.mode ??
        (item.kind === "directory"
          ? 0o755
          : item.kind === "symlink"
            ? 0o777
            : 0o644),
    );
    oct(108, 8, 0);
    oct(116, 8, 0);
    oct(124, 12, raw.length);
    oct(136, 12, 0);
    header.fill(32, 148, 156);
    header[156] =
      item.kind === "directory" ? 53 : item.kind === "symlink" ? 50 : 48;
    if (item.link) header.write(item.link, 157, 100);
    header.write("ustar\0", 257, 6);
    header.write("00", 263);
    header.write(
      [...header]
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148,
      8,
    );
    pieces.push(header, raw, Buffer.alloc((512 - (raw.length % 512)) % 512));
  }
  return Buffer.concat([...pieces, Buffer.alloc(1024)]);
}
function ar(members) {
  return Buffer.concat([
    Buffer.from("!<arch>\n"),
    ...members.flatMap(([name, raw]) => [
      Buffer.from(
        (name + "/").padEnd(16) +
          "0".padEnd(12) +
          "0".padEnd(6) +
          "0".padEnd(6) +
          "100644".padEnd(8) +
          String(raw.length).padEnd(10) +
          "`\n",
      ),
      raw,
      ...(raw.length % 2 ? [Buffer.from("\n")] : []),
    ]),
  ]);
}
function packageFixture(omitParents = false) {
  const control = [
    {
      path: "control",
      raw: Buffer.from(
        "Package: libllvm19\nSource: llvm-toolchain-19 (1:19.1.7-3)\nVersion: 1:19.1.7-3+vaettir1\nArchitecture: amd64\nDepends: libc6\nDescription: Synthetic fixture\n",
      ),
    },
    {
      path: "shlibs",
      raw: Buffer.from("libLLVM 19.1 libllvm19 (>= 1:19.1.7-3+vaettir1)\n"),
    },
    { path: "triggers", raw: Buffer.from("activate-noawait ldconfig\n") },
  ];
  const entries = [
    ...(!omitParents
      ? [
          "usr",
          "usr/lib",
          "usr/lib/x86_64-linux-gnu",
          "usr/share",
          "usr/share/doc",
          "usr/share/doc/libllvm19",
          "usr/share/vaettir",
        ].map((path) => ({ path, kind: "directory" }))
      : []),
    {
      path: "usr/lib/x86_64-linux-gnu/libLLVM.so.19.1",
      raw: Buffer.from("stripped candidate"),
    },
    {
      path: "usr/lib/x86_64-linux-gnu/libLLVM-19.so",
      kind: "symlink",
      link: "libLLVM.so.19.1",
    },
    {
      path: "usr/share/doc/libllvm19/copyright",
      raw: Buffer.from("Synthetic copyright"),
    },
    ...[
      "llvm-unstripped-abi.json",
      "llvm-source-manifest.json",
      "llvm-arm-policy-baseline.txt",
      "llvm-arm-unit-fixture-proof.json",
      "llvm-release-configuration.json",
      "llvm-assertions-configuration.json",
      "llvm-build-graphs.json",
      "llvm-arm-policy",
      "llvm-abi.json",
    ].map((name) => ({
      path: "usr/share/vaettir/" + name,
      mode: name === "llvm-arm-policy" ? 0o755 : 0o644,
      raw: Buffer.from("synthetic " + name),
    })),
  ];
  const raw = ar([
    ["debian-binary", Buffer.from("2.0\n")],
    ["control.tar.gz", gzipSync(tar(control))],
    ["data.tar.gz", gzipSync(tar(entries))],
  ]);
  return {
    raw,
    entries: inspectFinalDebianPackage(raw, (kind, bytes, max) => {
      assert.equal(kind, "gz");
      return decodeFinalGzip(bytes, max);
    }).entries,
  };
}

test("constructor imports only exact hash-verified builtin-only module bytes and copies external log", async () => {
  const f = fixture(),
    adapter = await createNativeFreshFinalAdapter(f.options, f.deps);
  assert.deepEqual(
    Object.keys(adapter.ops).sort(),
    [
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
    ].sort(),
  );
  assert.equal(f.calls.filter((c) => c[0] === "import").length, 2);
  assert.equal(f.calls.filter((c) => c[0] === "exec").length, 0);
  f.options.finalLog.fill(0);
  assert.equal(
    adapter.ops.readFinalLog(FINAL_LIMITS.log).toString(),
    "synthetic external compiler log\n",
  );
  assert.equal(adapter.provenance.outerWatchdogRequired, true);
  assert.equal(adapter.provenance.runtimeAcceptance, false);
  assert.equal(adapter.provenance.zstandardSupported, false);
});
test("unsupported Linux identity, flags, memory and admission refuse before import", async () => {
  for (const change of [
    (f) => (f.options.exclusiveWriter = false),
    (f) => (f.deps.platform = () => "win32"),
    (f) => (f.deps.uid = () => 1000),
    (f) => (f.options.memoryLimitBytes = 2 * GB),
    (f) => (f.deps.memory = () => ({ limit: 4 * GB, used: 3 * GB })),
    (f) => (f.options.deadlineMs = 0),
    (f) => (f.options.cleanupDeadlineMs = 300000),
    (f) => (f.options.other = true),
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(createNativeFreshFinalAdapter(f.options, f.deps));
    assert.equal(f.calls.length, 0);
  }
});
test("original module mismatch or non-builtin import cannot execute", async () => {
  for (const mutation of [
    (f) => f.v.file("/build/scripts/native-llvm-checkpoint.mjs", "changed"),
    (f) => {
      const raw = Buffer.from("import payload from './foreign.mjs';");
      f.v.file("/build/scripts/native-llvm-checkpoint.mjs", raw);
      f.options.scriptPins["native-llvm-checkpoint.mjs"] = hash(raw);
    },
  ]) {
    const f = fixture();
    mutation(f);
    await assert.rejects(createNativeFreshFinalAdapter(f.options, f.deps));
    assert.equal(f.calls.filter((c) => c[0] === "import").length, 0);
  }
});
test("arbitrary reads, hashes, directories and caller roots refuse before IO", async () => {
  const f = fixture(),
    { ops } = await createNativeFreshFinalAdapter(f.options, f.deps);
  for (const action of [
    () => ops.read("/etc/passwd", 1024),
    () => ops.hashFile("/build/unselected", 1024),
    () => ops.list("/tmp"),
    () => ops.exists("/tmp/foreign"),
  ])
    assert.throws(action);
  assert.ok(!f.v.calls.some((c) => c[1] === "/etc/passwd"));
  assert.throws(() => ops.read("/build/scripts/check-llvm-jit.c", 2 * MB));
});
test("regular reads reject symlinks and aliased ancestors; descriptors close on read races", async () => {
  const f = fixture(),
    { ops } = await createNativeFreshFinalAdapter(f.options, f.deps);
  f.v.add("/build/scripts/check-llvm-jit.c", "symlink", "/etc/passwd");
  assert.throws(() => ops.read("/build/scripts/check-llvm-jit.c", MB));
  f.v.file("/build/scripts/check-llvm-jit.c", "public");
  f.v.io.onRead = (data) => {
    data.node.mtimeMs++;
  };
  assert.throws(() => ops.read("/build/scripts/check-llvm-jit.c", MB));
  assert.equal(f.v.fds.size, 0);
  f.v.io.onRead = null;
  f.v.add("/build/scripts", "symlink", "/foreign");
  assert.throws(() => ops.read("/build/scripts/check-llvm-jit.c", MB));
});
test("native operations preserve exact original caps, exclusions and synchronous API", async () => {
  const f = fixture(),
    { ops } = await createNativeFreshFinalAdapter(f.options, f.deps);
  const bounds = {
    maxFiles: FINAL_LIMITS.files,
    maxBytes: FINAL_LIMITS.inventoryBytes,
  };
  ops.native.inventoryTree("/build/llvm-source", {
    ...bounds,
    exclude: ["debian/libllvm19", "debian/libllvm19.substvars"],
  });
  ops.native.hashCandidateLibrary("/build", "final", {
    maxBytes: FINAL_LIMITS.identityFile,
  });
  ops.native.verifyLlvmCompatibility({ a: 1 }, { b: 2 });
  assert.equal(f.nativeCalls.length, 3);
  assert.throws(() => ops.native.inventoryTree("/build/llvm-source", bounds));
  assert.throws(() => ops.native.inventoryTree("/build", bounds));
  assert.throws(() =>
    ops.native.hashCandidateLibrary("/build", "arbitrary", { maxBytes: 1 }),
  );
});
test("compiler reproduces full version and exact unsorted package inventory with fixed args/environment", async () => {
  const f = fixture(),
    { ops } = await createNativeFreshFinalAdapter(f.options, f.deps),
    actual = ops.compiler();
  assert.equal(
    actual.compiler,
    "Debian clang version 19.1.7 (3+b1)\nTarget: x86_64\n",
  );
  assert.equal(actual.compilerPackage, "1:19.1.7-3+b1");
  assert.equal(
    actual.installedPackagesSha256,
    hash(Buffer.from("z-package\t1\tamd64\na-package\t2\tamd64\n")),
  );
  for (const c of f.calls.filter((c) => c[0] === "exec")) {
    assert.equal(c[3].env.HOME, "/nonexistent");
    assert.equal(c[3].env.LD_LIBRARY_PATH, undefined);
    assert.equal(c[3].cwd, "/");
    assert.ok(c[3].timeout <= 30000);
  }
  assert.deepEqual(
    f.calls.filter((c) => c[0] === "exec").map((c) => c[2]),
    [
      ["--version"],
      ["-W", "-f=${Version}", "clang-19"],
      ["-W", "-f=${Package}\t${Version}\t${Architecture}\n"],
    ],
  );
});
test("ELF adapter resolves only exact generated candidate links and invokes full native tools", async () => {
  const f = fixture(),
    { ops } = await createNativeFreshFinalAdapter(f.options, f.deps),
    observed = ops.inspectElf("/build/llvm-build/lib/libLLVM.so.19.1");
  assert.equal(observed.sha256, hash(Buffer.from("candidate")));
  assert.equal(observed.symbols, "public_api T 0 4\n");
  assert.deepEqual(
    f.calls.filter((c) => c[0] === "exec").map((c) => c[2]),
    [
      ["-d", "/build/llvm-build/lib/libLLVM.so.1"],
      [
        "-D",
        "--defined-only",
        "--format=posix",
        "/build/llvm-build/lib/libLLVM.so.1",
      ],
    ],
  );
  f.v.add("/build/llvm-build/lib/libLLVM.so.19.1", "symlink", "../../foreign");
  assert.throws(() => ops.inspectElf("/build/llvm-build/lib/libLLVM.so.19.1"));
  assert.throws(() => ops.inspectElf("/build/arbitrary.so"));
});
test("gzip checks full framing, CRC, declared expansion and concatenation", () => {
  const data = Buffer.from("public synthetic tar bytes"),
    raw = gzipSync(data);
  assert.deepEqual(decodeFinalGzip(raw, 1000), data);
  for (const altered of [
    Buffer.concat([raw, raw]),
    Buffer.concat([raw, Buffer.from([0])]),
    raw.subarray(0, -1),
    (() => {
      const b = Buffer.from(raw);
      b[b.length - 8] ^= 1;
      return b;
    })(),
  ])
    assert.throws(() => decodeFinalGzip(altered, 1000));
  assert.throws(() => decodeFinalGzip(raw, 3));
});
test("XZ one-stream CRC/index envelope preflights output and rejects concatenation/oversize", () => {
  const raw = syntheticXz();
  assert.deepEqual(validateFinalXzFrame(raw, 1000), { blocks: 1, bytes: 100 });
  for (const bytes of [
    Buffer.concat([raw, raw]),
    Buffer.concat([raw, Buffer.alloc(4)]),
    (() => {
      const b = Buffer.from(raw);
      b[8] ^= 1;
      return b;
    })(),
  ])
    assert.throws(() => validateFinalXzFrame(bytes, 1000));
  assert.throws(() => validateFinalXzFrame(raw, 20));
});
test("XZ uses maintained fixed decoder; unsupported Zstandard never installs capability", async () => {
  const f = fixture(),
    { ops } = await createNativeFreshFinalAdapter(f.options, f.deps),
    raw = syntheticXz();
  f.deps.exec = (path, args, settings) => {
    f.calls.push(["exec", path, args, settings]);
    return Buffer.alloc(100, 1);
  };
  assert.equal(ops.decode("xz", raw, 1000).length, 100);
  assert.deepEqual(f.calls.at(-1)[2], [
    "--decompress",
    "--stdout",
    "--memlimit-decompress=256MiB",
  ]);
  assert.deepEqual(f.calls.at(-1)[3].input, raw);
  const prior = f.calls.length;
  assert.throws(
    () => ops.decode("zst", Buffer.from("unsupported"), 1000),
    /Unsupported/,
  );
  assert.equal(f.calls.length, prior);
});
test("exclusive extraction builds complete manifest with no package installation or scripts", async () => {
  const f = fixture(),
    adapter = await createNativeFreshFinalAdapter(f.options, f.deps),
    p = packageFixture(),
    root = "/tmp/vaettir-fresh-final-" + f.options.verificationId;
  assert.deepEqual(adapter.ops.extract(p.raw, root, p.entries), p.entries);
  assert.equal(f.calls.filter((c) => c[0] === "exec").length, 0);
  assert.ok(!f.v.calls.some((c) => c[0] === "mkdir" && !c[1].startsWith(root)));
  assert.equal(
    f.v.nodes.get(root + "/usr/share/vaettir/llvm-arm-policy").mode,
    0o755,
  );
  assert.equal(
    f.v.nodes.get(root + "/usr/lib/x86_64-linux-gnu/libLLVM-19.so").raw,
    "libLLVM.so.19.1",
  );
  assert.equal(f.v.fds.size, 0);
  const digest = adapter.ops.hashFile(
    root + "/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1",
    FINAL_LIMITS.packageFile,
  );
  assert.equal(digest.sha256, hash(Buffer.from("stripped candidate")));
});
test("preexisting extraction root, changed caller manifest, missing directories and disk shortage refuse before create", async () => {
  for (const mode of ["existing", "manifest", "parents", "disk"]) {
    const f = fixture(),
      adapter = await createNativeFreshFinalAdapter(f.options, f.deps),
      p = packageFixture(mode === "parents"),
      root = "/tmp/vaettir-fresh-final-" + f.options.verificationId;
    if (mode === "existing") f.v.directory(root);
    if (mode === "manifest") p.entries[0].mode = 0o777;
    if (mode === "disk") f.v.io.statfsSync = () => ({ bavail: 1, bsize: 4096 });
    assert.throws(() => adapter.ops.extract(p.raw, root, p.entries));
    assert.ok(!f.v.calls.some((c) => c[0] === "mkdir"));
  }
});
test("cleanup deletes only its exact inode-owned tree and preserves unrelated temporary data", async () => {
  const f = fixture(),
    adapter = await createNativeFreshFinalAdapter(f.options, f.deps),
    p = packageFixture(),
    root = "/tmp/vaettir-fresh-final-" + f.options.verificationId;
  f.v.file("/tmp/unrelated", "preserve");
  adapter.ops.extract(p.raw, root, p.entries);
  assert.deepEqual(adapter.cleanupOwnedExtraction(), { removed: true });
  assert.ok(!f.v.nodes.has(root));
  assert.equal(f.v.nodes.get("/tmp/unrelated").raw.toString(), "preserve");
  assert.deepEqual(adapter.cleanupOwnedExtraction(), { removed: false });
  assert.throws(() => adapter.ops.extract(p.raw, root, p.entries));
  assert.ok(
    f.v.calls
      .filter((c) => ["rmdir", "unlink"].includes(c[0]))
      .every((c) => c[1] === root || c[1].startsWith(root + "/")),
  );
});
test("cleanup refuses unexpected files or replacement inodes before any deletion", async () => {
  for (const mutate of [
    (f, root) => f.v.file(root + "/unrelated", "do not delete"),
    (f, root) =>
      f.v.file(root + "/usr/share/doc/libllvm19/copyright", "replacement"),
  ]) {
    const f = fixture(),
      adapter = await createNativeFreshFinalAdapter(f.options, f.deps),
      p = packageFixture(),
      root = "/tmp/vaettir-fresh-final-" + f.options.verificationId;
    adapter.ops.extract(p.raw, root, p.entries);
    mutate(f, root);
    assert.throws(() => adapter.cleanupOwnedExtraction());
    assert.equal(
      f.v.calls.filter((c) => ["unlink", "rmdir"].includes(c[0])).length,
      0,
    );
  }
});
test("partial failed extraction has explicit owned cleanup, not automatic retry or broad remove", async () => {
  const f = fixture(),
    adapter = await createNativeFreshFinalAdapter(f.options, f.deps),
    p = packageFixture(),
    root = "/tmp/vaettir-fresh-final-" + f.options.verificationId;
  f.v.io.failWrite = true;
  assert.throws(
    () => adapter.ops.extract(p.raw, root, p.entries),
    /write failure/,
  );
  assert.equal(f.v.fds.size, 0);
  assert.deepEqual(adapter.cleanupOwnedExtraction(), { removed: true });
  assert.ok(!f.v.nodes.has(root));
});
test("candidate probes use exact authored paths, clean environment and extracted library", async () => {
  const f = fixture(),
    adapter = await createNativeFreshFinalAdapter(f.options, f.deps),
    p = packageFixture(),
    root = "/tmp/vaettir-fresh-final-" + f.options.verificationId;
  adapter.ops.extract(p.raw, root, p.entries);
  const request = {
    loader: "/lib64/ld-linux-x86-64.so.2",
    libraryDirectory: root + "/usr/lib/x86_64-linux-gnu",
    path: "/build/llvm-cpu-jit",
    timeoutSeconds: 10,
    outputMax: 256,
    environment: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
  };
  assert.equal(
    adapter.ops.runProbe(request).toString(),
    "VAETTIR_LLVM_CPU_JIT_ADD_4_7=11\n",
  );
  const last = f.calls.filter((c) => c[0] === "exec").at(-1);
  assert.deepEqual(last[2], [
    "--library-path",
    request.libraryDirectory,
    request.path,
  ]);
  assert.equal(last[3].timeout, 10000);
  assert.equal(last[3].env.LD_PRELOAD, undefined);
  assert.equal(last[3].cwd, root);
  assert.throws(() =>
    adapter.ops.runProbe({ ...request, path: "/tmp/imported-code" }),
  );
  assert.throws(() =>
    adapter.ops.runProbe({
      ...request,
      environment: { ...request.environment, LD_PRELOAD: "foreign" },
    }),
  );
  f.v.file(root + "/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1", "changed");
  assert.throws(() => adapter.ops.runProbe(request));
});
test("deadline exhaustion refuses operations but retains separately bounded owned cleanup", async () => {
  const f = fixture(),
    adapter = await createNativeFreshFinalAdapter(f.options, f.deps),
    p = packageFixture(),
    root = "/tmp/vaettir-fresh-final-" + f.options.verificationId;
  adapter.ops.extract(p.raw, root, p.entries);
  f.clock.now = 200001;
  assert.throws(() => adapter.ops.readFinalLog(FINAL_LIMITS.log), /deadline/);
  assert.deepEqual(adapter.cleanupOwnedExtraction(), { removed: true });
  const second = fixture(),
    b = await createNativeFreshFinalAdapter(second.options, second.deps);
  second.clock.now = 0;
  assert.throws(() => b.ops.list("/build/scripts"), /Monotonic/);
});
test("native module/executable mutations and post-command timeout remain refusal", async () => {
  const f = fixture(),
    old = f.deps.importExact;
  f.deps.importExact = async (url) => {
    const result = await old(url);
    f.v.file(
      "/build/scripts/native-llvm-checkpoint.mjs",
      "changed after import",
    );
    return result;
  };
  await assert.rejects(createNativeFreshFinalAdapter(f.options, f.deps));
  const second = fixture(),
    { ops } = await createNativeFreshFinalAdapter(second.options, second.deps),
    execute = second.deps.exec;
  second.deps.exec = (...args) => {
    const value = execute(...args);
    second.clock.now = 200001;
    return value;
  };
  assert.throws(() => ops.compiler(), /deadline/);
});

test("caller mutation cannot extend frozen deadlines or rebind probe approval", async () => {
  const f = fixture(),
    adapter = await createNativeFreshFinalAdapter(f.options, f.deps);
  f.options.deadlineMs = Infinity;
  f.options.cleanupDeadlineMs = Infinity;
  f.options.verificationId = "b".repeat(64);
  f.options.scriptPins["native-llvm-checkpoint.mjs"] = "c".repeat(64);
  f.clock.now = 200001;
  assert.throws(() => adapter.ops.readFinalLog(FINAL_LIMITS.log), /deadline/);
  const second = fixture(),
    b = await createNativeFreshFinalAdapter(second.options, second.deps),
    p = packageFixture(),
    root = "/tmp/vaettir-fresh-final-" + second.options.verificationId;
  b.ops.extract(p.raw, root, p.entries);
  second.v.file("/build/llvm-cpu-jit", "changed binary", 0o755);
  second.options.probePins["llvm-cpu-jit"] = hash(
    Buffer.from("changed binary"),
  );
  assert.throws(
    () =>
      b.ops.runProbe({
        loader: "/lib64/ld-linux-x86-64.so.2",
        libraryDirectory: root + "/usr/lib/x86_64-linux-gnu",
        path: "/build/llvm-cpu-jit",
        timeoutSeconds: 10,
        outputMax: 256,
        environment: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
      }),
    /probe bytes not pinned/,
  );
  assert.equal(second.calls.filter((c) => c[0] === "exec").length, 0);
});
test("unexpected maintained executable targets and writable tools cannot run", async () => {
  for (const mutate of [
    (f) => {
      f.v.file("/usr/bin/foreign", "not a maintained tool", 0o755);
      f.v.add("/usr/bin/readelf", "symlink", "foreign");
    },
    (f) => {
      f.v.nodes.get("/usr/bin/readelf").mode = 0o777;
    },
  ]) {
    const f = fixture(),
      { ops } = await createNativeFreshFinalAdapter(f.options, f.deps);
    mutate(f);
    assert.throws(() => ops.inspectDynamic("/build/llvm-cpu-jit"));
    assert.equal(f.calls.filter((c) => c[0] === "exec").length, 0);
  }
});
test("cleanup refuses in-place modification and expired cleanup budget", async () => {
  const f = fixture(),
    adapter = await createNativeFreshFinalAdapter(f.options, f.deps),
    p = packageFixture(),
    root = "/tmp/vaettir-fresh-final-" + f.options.verificationId;
  adapter.ops.extract(p.raw, root, p.entries);
  const node = f.v.nodes.get(root + "/usr/share/doc/libllvm19/copyright");
  node.raw = Buffer.from("replacement same inode");
  node.ctimeMs++;
  assert.throws(() => adapter.cleanupOwnedExtraction(), /Cleanup identity/);
  assert.equal(
    f.v.calls.filter((c) => ["unlink", "rmdir"].includes(c[0])).length,
    0,
  );
  f.clock.now = 275001;
  assert.throws(() => adapter.cleanupOwnedExtraction(), /deadline/);
});
test("subprocesses enforce output caps, SIGKILL and no shell", async () => {
  const f = fixture(),
    { ops } = await createNativeFreshFinalAdapter(f.options, f.deps);
  ops.inspectDynamic("/build/llvm-arm-policy");
  const call = f.calls.filter((c) => c[0] === "exec").at(-1);
  assert.equal(call[3].killSignal, "SIGKILL");
  assert.equal(call[3].shell, undefined);
  assert.equal(call[3].maxBuffer, 32 * MB);
  f.deps.exec = () => Buffer.alloc(32 * MB + 1);
  assert.throws(
    () => ops.inspectDynamic("/build/llvm-arm-policy"),
    /Bounded bytes/,
  );
});
