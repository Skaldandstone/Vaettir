import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  NATIVE_SOURCE_ROOT,
  NATIVE_SOURCE_OBSERVER_LIMITS,
  captureNativeSourceInventory,
  diffNativeSourceInventories,
} from "./native-source-inventory-observer.mjs";

// Memory-only PUBLIC synthetic fixtures. No native source, Docker, DB or cloud.
const root = NATIVE_SOURCE_ROOT;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const file = (data, mode = 0o644) => ({
  kind: "file",
  data: Buffer.from(data),
  mode,
});
const directory = () => ({ kind: "directory", mode: 0o755 });
const link = (target) => ({ kind: "symlink", target, mode: 0o777 });
function memoryFs(entries) {
  const nodes = new Map([[root, directory()]]),
    descriptors = new Map();
  let next = 1,
    reads = 0;
  for (const [name, value] of Object.entries(entries))
    nodes.set(root + "/" + name, value);
  for (const path of [...nodes.keys()]) {
    let parent = posix.dirname(path);
    while (parent.startsWith(root + "/")) {
      if (!nodes.has(parent)) nodes.set(parent, directory());
      parent = posix.dirname(parent);
    }
  }
  const stat = (node) => {
    assert.ok(node, "Synthetic path missing");
    return {
      dev: 1,
      ino: node.ino ?? 1,
      mode: node.mode,
      size: node.size ?? node.data?.length ?? 0,
      mtimeMs: node.mtimeMs ?? 0,
      ctimeMs: node.ctimeMs ?? 0,
      isFile: () => node.kind === "file",
      isDirectory: () => node.kind === "directory",
      isSymbolicLink: () => node.kind === "symlink",
    };
  };
  const fs = {
    nodes,
    descriptors,
    get reads() {
      return reads;
    },
    lstatSync: (path) => stat(nodes.get(path)),
    realpathSync: (path) => path,
    readdirSync: (path) =>
      [...nodes.keys()]
        .filter((item) => item !== root && posix.dirname(item) === path)
        .map((item) => posix.basename(item))
        .reverse(),
    readlinkSync: (path) => nodes.get(path).target,
    openSync: (path) => {
      const fd = next++;
      descriptors.set(fd, { path, offset: 0, node: nodes.get(path) });
      return fd;
    },
    fstatSync: (fd) => stat(descriptors.get(fd).node),
    readSync: (fd, target, offset, length) => {
      reads++;
      const descriptor = descriptors.get(fd),
        data = descriptor.node.data;
      const count = Math.min(length, data.length - descriptor.offset);
      data.copy(target, offset, descriptor.offset, descriptor.offset + count);
      descriptor.offset += count;
      return count;
    },
    closeSync: (fd) => {
      assert.ok(descriptors.delete(fd));
    },
  };
  return fs;
}

// Execute the ACTUAL original inventoryTree/hashFile source with synthetic fs.
// No native module side effects, no source body read outside this public helper.
const checkpointSource = readFileSync(
  new URL("./native-llvm-checkpoint.mjs", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const originalHash = checkpointSource.slice(
  checkpointSource.indexOf("function hashFile("),
  checkpointSource.indexOf("\n// CMake"),
);
const originalInventory = checkpointSource.slice(
  checkpointSource.indexOf("export function inventoryTree("),
  checkpointSource.indexOf("\nexport function assertionCompilePlan("),
);
assert.ok(originalHash.startsWith("function hashFile("));
assert.ok(originalInventory.startsWith("export function inventoryTree("));
function original(fs) {
  const value = runInNewContext(
    `${originalHash}\n${originalInventory.replace("export function", "function")}\ninventoryTree(root, {exclude:["debian/libllvm19","debian/libllvm19.substvars"]})`,
    {
      ...fs,
      assert,
      createHash,
      Buffer,
      root,
      resolve: posix.resolve,
      join: posix.join,
      relative: posix.relative,
      sep: "/",
      MAX_FILE: 4 * 1024 ** 3,
      MAX_FILES: 400000,
      MAX_BYTES: 64 * 1024 ** 3,
      encode: JSON.stringify,
    },
  );
  return JSON.parse(JSON.stringify(value));
}
function pins(expected) {
  return {
    schemaVersion: 1,
    purpose: "public-native-source-integrity-diagnostic",
    sourceRoot: root,
    parentImageDigest: "sha256:" + "a".repeat(64),
    parentReceiptSha256: "b".repeat(64),
    expectedSource: expected,
  };
}
function capture(entries, stage = "BEFORE", context, options = {}) {
  const fs = memoryFs(entries);
  return captureNativeSourceInventory(context ?? pins(original(fs)), stage, {
    filesystem: fs,
    ...options,
  });
}
function pair(beforeEntries, afterEntries) {
  const before = capture(beforeEntries);
  return [before, capture(afterEntries, "AFTER", before.context)];
}
const clone = (value) => JSON.parse(JSON.stringify(value));
function resign(snapshot) {
  snapshot.aggregate = {
    sha256: hash(
      snapshot.records.map((record) => JSON.stringify(record) + "\n").join(""),
    ),
    entries: snapshot.records.length,
    bytes: snapshot.records.reduce(
      (sum, record) => sum + (record[1] === "file" ? record[3] : 0),
      0,
    ),
  };
  snapshot.detailSha256 = hash(JSON.stringify(snapshot.records));
  snapshot.detailBytes = Buffer.byteLength(JSON.stringify(snapshot.records));
  return snapshot;
}

test("exact original inventory vectors, DFS, exclusions, modes, raw symlinks and UTF8", () => {
  const entries = {
    "a/z": file("z"),
    "a.b": file("dot"),
    "a/α": file("hello α", 0o600),
    empty: directory(),
    link: link("a/../a/z"),
    "literal\\name": file("backslash"),
    "debian/libllvm19/ignored": file("ignored"),
    "debian/libllvm19.substvars": file("ignored"),
    "debian/libllvm19.extra": file("included"),
    "debian/rules": file("public synthetic rules"),
  };
  const fs = memoryFs(entries),
    expected = original(fs);
  const result = captureNativeSourceInventory(pins(expected), "BEFORE", {
    filesystem: fs,
  });
  assert.deepEqual(result.aggregate, expected);
  assert.deepEqual(
    result.records.map((record) => record[0]),
    [
      "a",
      "a/z",
      "a/α",
      "a.b",
      "debian",
      "debian/libllvm19.extra",
      "debian/rules",
      "empty",
      "link",
      "literal\\name",
    ],
  );
  assert.deepEqual(
    result.records.find((record) => record[0] === "link"),
    ["link", "symlink", "a/../a/z"],
  );
  assert.equal(result.detailSha256, hash(JSON.stringify(result.records)));
  assert.equal(
    result.detailBytes,
    Buffer.byteLength(JSON.stringify(result.records)),
  );
  assert.equal(fs.descriptors.size, 0);
  assert.ok(Object.values(result.acceptance).every((flag) => flag === false));
});

test("complete mixed changes are not inferred from net counts; inputs remain unchanged", () => {
  const [before, after] = pair(
    {
      same: file("s"),
      gone: file("gone"),
      mode: file("m"),
      content: file("old"),
      type: file("t"),
      link: link("same"),
    },
    {
      same: file("s"),
      added: file("added"),
      mode: file("m", 0o755),
      content: file("new longer"),
      type: directory(),
      "type/child": file("child"),
      link: link("./same"),
    },
  );
  const immutable = JSON.stringify([before, after]);
  const result = diffNativeSourceInventories(before, after);
  assert.equal(result.netEntries, 1);
  assert.deepEqual(
    result.differences.map((item) => [
      item.path,
      item.change,
      item.changedFields,
    ]),
    [
      ["added", "ADDED", ["presence"]],
      ["content", "MODIFIED", ["bytes", "sha256"]],
      ["gone", "REMOVED", ["presence"]],
      ["link", "MODIFIED", ["target"]],
      ["mode", "MODIFIED", ["mode"]],
      ["type", "TYPE_CHANGED", ["type"]],
      ["type/child", "ADDED", ["presence"]],
    ],
  );
  assert.equal(
    result.differencesSha256,
    hash(JSON.stringify(result.differences)),
  );
  assert.equal(
    result.differenceBytes,
    Buffer.byteLength(JSON.stringify(result.differences)),
  );
  assert.equal(JSON.stringify([before, after]), immutable);
  assert.ok(Object.values(result.acceptance).every((flag) => flag === false));
  assert.ok(!JSON.stringify(result).includes("new longer"));
});

test("unchanged complete source and empty tree reproduce native aggregate", () => {
  for (const entries of [{}, { one: file(""), dir: directory() }]) {
    const [before, after] = pair(entries, entries);
    const diff = diffNativeSourceInventories(before, after);
    assert.deepEqual(diff.differences, []);
    assert.equal(diff.netEntries, 0);
    assert.equal(diff.netBytes, 0);
  }
});

test("strict fixed context, original BEFORE pin and stages refuse foreign/rebased identities", () => {
  const [before, after] = pair({ a: file("a") }, { a: file("b") });
  for (const mutation of [
    (c) => {
      c.sourceRoot = "/tmp/source";
    },
    (c) => {
      c.parentImageDigest = "sha256:old";
    },
    (c) => {
      c.parentReceiptSha256 = "f";
    },
    (c) => {
      c.extra = true;
    },
    (c) => {
      c.expectedSource.bytes++;
    },
  ]) {
    const c = clone(before.context);
    mutation(c);
    assert.throws(() => capture({ a: file("a") }, "BEFORE", c));
  }
  assert.throws(() => capture({}, "FINAL"));
  const foreign = clone(after);
  foreign.context.parentImageDigest = "sha256:" + "c".repeat(64);
  assert.throws(
    () => diffNativeSourceInventories(before, foreign),
    /context mismatch/,
  );
  const rebased = clone(before);
  rebased.context.expectedSource = after.aggregate;
  assert.throws(
    () => diffNativeSourceInventories(rebased, after),
    /differs before/,
  );
  assert.throws(() => diffNativeSourceInventories(after, before));
});

test("entry/file/total/detail/diff bounds only tighten and never truncate", () => {
  const entries = { a: file("1234"), b: file("1234") },
    fs = memoryFs(entries),
    context = pins(original(fs));
  for (const overrides of [
    { entries: 1 },
    { bytes: 7 },
    { fileBytes: 3 },
    { detailBytes: 10 },
  ])
    assert.throws(() =>
      capture(entries, "BEFORE", context, { limits: overrides }),
    );
  for (const overrides of [
    { entries: 400001 },
    { bytes: 64 * 1024 ** 3 + 1 },
    { differenceBytes: 1024 ** 2 + 1 },
    { unknown: 1 },
    { entries: 0 },
  ])
    assert.throws(() =>
      capture(entries, "BEFORE", context, { limits: overrides }),
    );
  const pairValue = pair(entries, { a: file("5"), c: file("6") });
  assert.throws(
    () =>
      diffNativeSourceInventories(...pairValue, { limits: { differences: 2 } }),
    /nothing truncated/,
  );
  assert.throws(
    () =>
      diffNativeSourceInventories(...pairValue, {
        limits: { differenceBytes: 30 },
      }),
    /nothing truncated/,
  );
  const huge = memoryFs({
    huge: { ...file("x"), size: NATIVE_SOURCE_OBSERVER_LIMITS.fileBytes + 1 },
  });
  assert.throws(() =>
    captureNativeSourceInventory(
      pins({ sha256: "d".repeat(64), entries: 1, bytes: 0 }),
      "AFTER",
      { filesystem: huge },
    ),
  );
  assert.equal(huge.reads, 0);
});

test("default complete 512 difference boundary passes; 513 refuses whole result", () => {
  const entries = (count) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        String(index).padStart(4, "0"),
        file("x"),
      ]),
    );
  assert.equal(
    diffNativeSourceInventories(...pair({}, entries(512))).differences.length,
    512,
  );
  assert.throws(
    () => diffNativeSourceInventories(...pair({}, entries(513))),
    /count bound exceeded/,
  );
});

test("metadata bounds cover complete envelope, not only record/difference arrays", () => {
  const before = capture({ a: file("a") });
  assert.throws(
    () =>
      capture({ a: file("a") }, "BEFORE", before.context, {
        limits: { detailBytes: before.detailBytes + 1 },
      }),
    /snapshot metadata bound/,
  );
  const values = pair({ a: file("a") }, { a: file("b") });
  const diff = diffNativeSourceInventories(...values);
  assert.throws(
    () =>
      diffNativeSourceInventories(...values, {
        limits: { differenceBytes: diff.differenceBytes + 1 },
      }),
    /difference metadata bound/,
  );
});

test("unsupported special files, escaping links and aliased directories refuse", () => {
  for (const entries of [
    { bad: { kind: "fifo", mode: 0o600 } },
    { link: link("../outside") },
    { link: link("/etc/passwd") },
  ]) {
    const fs = memoryFs(entries);
    assert.throws(() =>
      captureNativeSourceInventory(
        pins({ sha256: "d".repeat(64), entries: 0, bytes: 0 }),
        "AFTER",
        { filesystem: fs },
      ),
    );
  }
  const fs = memoryFs({ "dir/file": file("safe") });
  fs.realpathSync = () => "/outside";
  assert.throws(
    () =>
      captureNativeSourceInventory(
        pins({ sha256: "d".repeat(64), entries: 0, bytes: 0 }),
        "AFTER",
        { filesystem: fs },
      ),
    /canonical/,
  );
});

test("descriptor/size/mode/directory changes fail closed and close descriptors", () => {
  for (const type of ["grow", "short", "mode", "inode", "directory"]) {
    const fs = memoryFs({ a: file("safe") }),
      expected = original(fs),
      originalRead = fs.readSync;
    let called = false;
    fs.readSync = (...args) => {
      if (!called) {
        called = true;
        const node = fs.nodes.get(root + "/a");
        if (type === "grow") node.data = Buffer.from("longer than safe");
        if (type === "short") node.data = Buffer.from("s");
        if (type === "mode") node.mode = 0o755;
        if (type === "inode") node.ino = 2;
        if (type === "directory") fs.nodes.set(root + "/extra", file("e"));
      }
      return originalRead(...args);
    };
    assert.throws(() =>
      captureNativeSourceInventory(pins(expected), "BEFORE", {
        filesystem: fs,
      }),
    );
    assert.equal(fs.descriptors.size, 0);
  }
});

test("snapshot tamper, malformed records, missing parents and reordered DFS refuse", () => {
  const [before, after] = pair(
    { "a/x": file("x"), "a.b": file("b") },
    { "a/x": file("y"), "a.b": file("b") },
  );
  for (const mutation of [
    (s) => {
      s.aggregate.sha256 = "f".repeat(64);
    },
    (s) => {
      s.detailSha256 = "f".repeat(64);
    },
    (s) => {
      s.detailBytes--;
    },
    (s) => {
      s.complete = false;
    },
    (s) => {
      s.acceptance.runtimeAccepted = true;
    },
    (s) => {
      s.rawBody = "private";
    },
    (s) => {
      s.records[0].push("extra");
    },
    (s) => {
      s.records[1][3] = -1;
    },
    (s) => {
      s.records[1][4] = "wrong";
    },
  ]) {
    const bad = clone(after);
    mutation(bad);
    assert.throws(() => diffNativeSourceInventories(before, bad));
  }
  for (const mutation of [
    (s) => s.records.reverse(),
    (s) => s.records.push([...s.records[1]]),
    (s) => s.records.splice(0, 1),
    (s) => {
      s.records[1][0] = "../outside";
    },
    (s) => {
      s.records[1][0] = "debian/libllvm19/out";
    },
  ]) {
    const bad = clone(after);
    mutation(bad);
    resign(bad);
    assert.throws(() => diffNativeSourceInventories(before, bad));
  }
});

test("directory/symlink permission changes are honestly absent from native identity", () => {
  const entries = { "dir/file": file("x"), link: link("dir/file") },
    fs = memoryFs(entries),
    expected = original(fs);
  const before = captureNativeSourceInventory(pins(expected), "BEFORE", {
    filesystem: fs,
  });
  fs.nodes.get(root + "/dir").mode = 0o700;
  fs.nodes.get(root + "/link").mode = 0o600;
  const after = captureNativeSourceInventory(before.context, "AFTER", {
    filesystem: fs,
  });
  assert.deepEqual(after.aggregate, original(fs));
  const diff = diffNativeSourceInventories(before, after);
  assert.deepEqual(diff.differences, []);
  assert.ok(
    diff.limitations.some((text) => text.includes("Directory/symlink modes")),
  );
});

test("module stays callable-only; no runtime/checkpoint/cloud execution or writes", () => {
  const source = readFileSync(
    new URL("./native-source-inventory-observer.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    !/child_process|execFile|spawn\(|writeFile|unlink|mkdir|rename|fetch\(|checkpointStore|process\.argv/.test(
      source,
    ),
  );
  assert.ok(!/from ["']\.\//.test(source));
  assert.ok(!source.includes("debian/libllvm19.substvars/extra"));
  let calls = 0;
  const noIO = new Proxy(
    {},
    {
      get() {
        calls++;
        throw new Error("Import-time filesystem access");
      },
    },
  );
  runInNewContext(
    source.replace(/^import .+;\r?$/gm, "").replace(/^export /gm, ""),
    { assert, createHash, realFilesystem: noIO, posix, Buffer, process },
  );
  assert.equal(calls, 0);
});

test("metadata and vector accessors never execute during validation", () => {
  const [before, after] = pair({ a: file("a") }, { a: file("b") });
  for (const location of ["context", "record", "records"]) {
    let calls = 0;
    const bad = clone(after);
    const object =
      location === "context"
        ? bad.context
        : location === "record"
          ? bad.records[0]
          : bad.records;
    const key = location === "context" ? "purpose" : "0";
    Object.defineProperty(object, key, {
      enumerable: true,
      get() {
        calls++;
        return "unsupported";
      },
    });
    assert.throws(() => diffNativeSourceInventories(before, bad));
    assert.equal(calls, 0);
  }
});
