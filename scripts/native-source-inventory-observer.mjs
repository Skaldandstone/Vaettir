// External, read-only PUBLIC LLVM integrity diagnostic. This is not a native
// checkpoint input and cannot authorize units, packaging or a runtime release.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as realFilesystem from "node:fs";
import { posix } from "node:path";

export const NATIVE_SOURCE_ROOT = "/build/llvm-source";
export const NATIVE_SOURCE_OBSERVER_LIMITS = Object.freeze({
  entries: 400000,
  bytes: 64 * 1024 ** 3,
  fileBytes: 4 * 1024 ** 3,
  detailBytes: 64 * 1024 ** 2,
  differences: 512,
  differenceBytes: 1024 ** 2,
});
const EXCLUDED = ["debian/libllvm19", "debian/libllvm19.substvars"];
const HASH = /^[a-f0-9]{64}$/;
const PURPOSE = "public-native-source-integrity-diagnostic";
const ACCEPTANCE = Object.freeze({
  nativePhaseAccepted: false,
  unitSuitesAccepted: false,
  packageAccepted: false,
  runtimeAccepted: false,
  deploymentAccepted: false,
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const excluded = (path) =>
  EXCLUDED.some((item) => path === item || path.startsWith(item + "/"));
function keys(value, expected) {
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  assert.equal(Object.getOwnPropertySymbols(value).length, 0);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  ))
    assert.ok("value" in descriptor, "Accessor metadata is unsupported");
}
function plainArray(value) {
  assert.ok(
    Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype,
  );
  assert.equal(Object.getOwnPropertySymbols(value).length, 0);
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  ))
    assert.ok("value" in descriptor, "Accessor inventory is unsupported");
}
function integer(value, maximum, minimum = 0) {
  assert.ok(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
  );
}
function boundedString(value, maximum) {
  assert.ok(typeof value === "string" && !value.includes("\0"));
  assert.ok(Buffer.byteLength(value, "utf8") <= maximum);
}
function limits(options = {}) {
  keys(options, Object.keys(options));
  const result = { ...NATIVE_SOURCE_OBSERVER_LIMITS };
  for (const [key, value] of Object.entries(options)) {
    assert.ok(Object.hasOwn(result, key), "Unknown observer limit");
    integer(value, result[key], 1);
    result[key] = value;
  }
  return result;
}
function aggregate(value, bounds) {
  keys(value, ["sha256", "entries", "bytes"]);
  assert.match(value.sha256, HASH);
  integer(value.entries, bounds.entries);
  integer(value.bytes, bounds.bytes);
  return { sha256: value.sha256, entries: value.entries, bytes: value.bytes };
}
function context(value, bounds) {
  keys(value, [
    "schemaVersion",
    "purpose",
    "sourceRoot",
    "parentImageDigest",
    "parentReceiptSha256",
    "expectedSource",
  ]);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.purpose, PURPOSE);
  assert.equal(value.sourceRoot, NATIVE_SOURCE_ROOT);
  assert.match(value.parentImageDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(value.parentReceiptSha256, HASH);
  return {
    schemaVersion: 1,
    purpose: PURPOSE,
    sourceRoot: NATIVE_SOURCE_ROOT,
    parentImageDigest: value.parentImageDigest,
    parentReceiptSha256: value.parentReceiptSha256,
    expectedSource: aggregate(value.expectedSource, bounds),
  };
}
function pathName(value) {
  boundedString(value, 4096);
  assert.ok(value.length && !value.startsWith("/"));
  assert.ok(
    value.split("/").every((part) => part && part !== "." && part !== ".."),
  );
  assert.ok(!excluded(value), "Excluded packaging path in inventory");
}
function symlinkTarget(path, target) {
  boundedString(target, 4096);
  const destination = posix.resolve(
    posix.dirname(posix.join(NATIVE_SOURCE_ROOT, path)),
    target,
  );
  assert.ok(
    destination === NATIVE_SOURCE_ROOT ||
      destination.startsWith(NATIVE_SOURCE_ROOT + "/"),
    "Identity symlink escapes owned root",
  );
}
function recordShape(record, bounds) {
  plainArray(record);
  assert.deepEqual(
    Object.keys(record),
    record.map((_, index) => String(index)),
  );
  pathName(record[0]);
  if (record[1] === "directory") assert.equal(record.length, 2);
  else if (record[1] === "symlink") {
    assert.equal(record.length, 3);
    symlinkTarget(record[0], record[2]);
  } else {
    assert.equal(record[1], "file", "Special/unknown inventory type");
    assert.equal(record.length, 5);
    integer(record[2], 0o777);
    integer(record[3], bounds.fileBytes);
    assert.match(record[4], HASH);
  }
}
// Exact original per-record aggregate; detail hash separately binds the vector.
function measure(records, bounds) {
  assert.ok(Array.isArray(records) && records.length <= bounds.entries);
  plainArray(records);
  assert.deepEqual(
    Object.keys(records),
    Array.from({ length: records.length }, (_, index) => String(index)),
  );
  const digest = createHash("sha256"),
    detail = createHash("sha256");
  let bytes = 0,
    detailBytes = 2;
  detail.update("[");
  for (const [index, record] of records.entries()) {
    recordShape(record, bounds);
    const encoded = JSON.stringify(record);
    detailBytes += Buffer.byteLength(encoded) + (index ? 1 : 0);
    assert.ok(
      detailBytes <= bounds.detailBytes,
      "Complete detail metadata bound exceeded",
    );
    digest.update(encoded + "\n");
    if (index) detail.update(",");
    detail.update(encoded);
    if (record[1] === "file") bytes += record[3];
    assert.ok(bytes <= bounds.bytes, "Identity byte bound exceeded");
  }
  detail.update("]");
  return {
    aggregate: { sha256: digest.digest("hex"), entries: records.length, bytes },
    detailSha256: detail.digest("hex"),
    detailBytes,
  };
}
function ordered(records) {
  const byPath = new Map(),
    children = new Map([["", []]]);
  for (const record of records) {
    const path = record[0],
      parent = posix.dirname(path) === "." ? "" : posix.dirname(path);
    assert.ok(!byPath.has(path), "Duplicate inventory path");
    assert.ok(children.has(parent), "Missing/non-directory inventory parent");
    children.get(parent).push(path);
    byPath.set(path, record);
    if (record[1] === "directory") children.set(path, []);
  }
  for (const names of children.values())
    names.sort((a, b) => {
      const first = posix.basename(a),
        second = posix.basename(b);
      return first < second ? -1 : first > second ? 1 : 0;
    });
  const pending = [...children.get("")].reverse();
  let index = 0;
  while (pending.length) {
    const path = pending.pop();
    assert.equal(
      records[index++][0],
      path,
      "Inventory must retain native sorted-name DFS order",
    );
    if (children.has(path)) {
      const names = children.get(path);
      for (let child = names.length - 1; child >= 0; child--)
        pending.push(names[child]);
    }
  }
  assert.equal(index, records.length);
  return byPath;
}
function validate(snapshot, bounds) {
  keys(snapshot, [
    "schemaVersion",
    "context",
    "stage",
    "aggregate",
    "records",
    "detailSha256",
    "detailBytes",
    "complete",
    "acceptance",
  ]);
  assert.equal(snapshot.schemaVersion, 1);
  const pinned = context(snapshot.context, bounds);
  assert.ok(snapshot.stage === "BEFORE" || snapshot.stage === "AFTER");
  assert.equal(snapshot.complete, true);
  keys(snapshot.acceptance, Object.keys(ACCEPTANCE));
  assert.deepEqual(snapshot.acceptance, ACCEPTANCE);
  const measured = measure(snapshot.records, bounds);
  assert.deepEqual(aggregate(snapshot.aggregate, bounds), measured.aggregate);
  assert.equal(snapshot.detailSha256, measured.detailSha256);
  assert.equal(snapshot.detailBytes, measured.detailBytes);
  if (snapshot.stage === "BEFORE")
    assert.deepEqual(
      measured.aggregate,
      pinned.expectedSource,
      "Original source inventory differs before diagnostic",
    );
  assert.ok(
    Buffer.byteLength(JSON.stringify(snapshot)) <= bounds.detailBytes,
    "Complete snapshot metadata bound exceeded; nothing truncated",
  );
  return { pinned, measured, byPath: ordered(snapshot.records) };
}
function statIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

/** No writes, shell, network, native imports or import-time filesystem access.
 * A trusted injected filesystem allows synthetic tests without native paths.
 * Context pins are externally verified inputs, not observer-granted authority.
 */
export function captureNativeSourceInventory(
  pins,
  stage,
  { filesystem = realFilesystem, limits: overrides = {} } = {},
) {
  const bounds = limits(overrides),
    pinned = context(pins, bounds);
  assert.ok(stage === "BEFORE" || stage === "AFTER");
  if (filesystem === realFilesystem)
    assert.equal(process.platform, "linux", "Fixed native root requires Linux");
  const base = NATIVE_SOURCE_ROOT;
  const rootStat = filesystem.lstatSync(base);
  assert.ok(
    rootStat.isDirectory() && filesystem.realpathSync(base) === base,
    "Source root must be real and canonical",
  );
  const records = [],
    stack = [];
  let bytes = 0,
    detailBytes = 2;
  const emit = (record) => {
    recordShape(record, bounds);
    assert.ok(
      records.length < bounds.entries,
      "Identity file-count bound exceeded",
    );
    detailBytes +=
      Buffer.byteLength(JSON.stringify(record)) + (records.length ? 1 : 0);
    assert.ok(
      detailBytes <= bounds.detailBytes,
      "Complete detail metadata bound exceeded",
    );
    records.push(record);
  };
  const enter = (path) => {
    assert.ok(stack.length < 1024, "Directory depth bound exceeded");
    const stat = filesystem.lstatSync(path);
    assert.ok(
      stat.isDirectory() && filesystem.realpathSync(path) === path,
      "Directory became aliased",
    );
    const names = filesystem.readdirSync(path).sort();
    assert.ok(
      names.length <= bounds.entries + 2,
      "Directory entry bound exceeded",
    );
    for (const name of names) {
      boundedString(name, 4096);
      assert.ok(name && name !== "." && name !== ".." && !name.includes("/"));
    }
    assert.equal(
      new Set(names).size,
      names.length,
      "Duplicate directory entry",
    );
    stack.push({ path, stat, names, index: 0 });
  };
  enter(base);
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.names.length) {
      assert.deepEqual(
        statIdentity(filesystem.lstatSync(frame.path)),
        statIdentity(frame.stat),
        "Directory changed during inventory",
      );
      assert.deepEqual(
        filesystem.readdirSync(frame.path).sort(),
        frame.names,
        "Directory entries changed during inventory",
      );
      stack.pop();
      continue;
    }
    const path = posix.join(frame.path, frame.names[frame.index++]);
    const relative = posix.relative(base, path);
    if (excluded(relative)) continue;
    const stat = filesystem.lstatSync(path);
    if (stat.isSymbolicLink()) {
      const target = filesystem.readlinkSync(path);
      emit([relative, "symlink", target]);
      assert.deepEqual(
        statIdentity(filesystem.lstatSync(path)),
        statIdentity(stat),
        "Symlink changed during inventory",
      );
      assert.equal(filesystem.readlinkSync(path), target);
    } else if (stat.isDirectory()) {
      emit([relative, "directory"]);
      enter(path);
    } else {
      assert.ok(stat.isFile(), "Special files cannot enter inventory");
      integer(stat.size, bounds.fileBytes);
      bytes += stat.size;
      assert.ok(bytes <= bounds.bytes, "Identity byte bound exceeded");
      const fd = filesystem.openSync(
        path,
        realFilesystem.constants.O_RDONLY |
          (realFilesystem.constants.O_NOFOLLOW ?? 0),
      );
      const digest = createHash("sha256");
      let readBytes = 0;
      try {
        assert.deepEqual(
          statIdentity(filesystem.fstatSync(fd)),
          statIdentity(stat),
          "File changed before hashing",
        );
        for (;;) {
          const count = filesystem.readSync(fd, buffer, 0, buffer.length, null);
          integer(count, buffer.length);
          if (!count) break;
          readBytes += count;
          assert.ok(
            readBytes <= stat.size && readBytes <= bounds.fileBytes,
            "File grew while hashing",
          );
          digest.update(buffer.subarray(0, count));
        }
        assert.equal(readBytes, stat.size, "File size changed while hashing");
        assert.deepEqual(
          statIdentity(filesystem.fstatSync(fd)),
          statIdentity(stat),
          "File changed while hashing",
        );
      } finally {
        filesystem.closeSync(fd);
      }
      assert.deepEqual(
        statIdentity(filesystem.lstatSync(path)),
        statIdentity(stat),
        "File changed while hashing",
      );
      emit([
        relative,
        "file",
        stat.mode & 0o777,
        stat.size,
        digest.digest("hex"),
      ]);
    }
  }
  const measured = measure(records, bounds);
  const result = {
    schemaVersion: 1,
    context: pinned,
    stage,
    ...measured,
    records,
    complete: true,
    acceptance: { ...ACCEPTANCE },
  };
  validate(result, bounds);
  return result;
}

export function diffNativeSourceInventories(
  before,
  after,
  { limits: overrides = {} } = {},
) {
  const bounds = limits(overrides),
    first = validate(before, bounds),
    second = validate(after, bounds);
  assert.equal(before.stage, "BEFORE");
  assert.equal(after.stage, "AFTER");
  assert.deepEqual(
    first.pinned,
    second.pinned,
    "Diagnostic parent/context mismatch",
  );
  const paths = [
    ...new Set([...first.byPath.keys(), ...second.byPath.keys()]),
  ].sort();
  const differences = [];
  let differenceBytes = 2;
  for (const path of paths) {
    const old = first.byPath.get(path) ?? null,
      current = second.byPath.get(path) ?? null;
    if (JSON.stringify(old) === JSON.stringify(current)) continue;
    let change, changedFields;
    if (!old || !current) {
      change = old ? "REMOVED" : "ADDED";
      changedFields = ["presence"];
    } else if (old[1] !== current[1]) {
      change = "TYPE_CHANGED";
      changedFields = ["type"];
    } else {
      change = "MODIFIED";
      changedFields =
        old[1] === "symlink"
          ? ["target"]
          : ["mode", "bytes", "sha256"].filter(
              (_, index) => old[index + 2] !== current[index + 2],
            );
    }
    const item = {
      path,
      change,
      changedFields,
      before: old && [...old],
      after: current && [...current],
    };
    assert.ok(
      differences.length < bounds.differences,
      "Complete difference count bound exceeded; nothing truncated",
    );
    differenceBytes +=
      Buffer.byteLength(JSON.stringify(item)) + (differences.length ? 1 : 0);
    assert.ok(
      differenceBytes <= bounds.differenceBytes,
      "Complete difference byte bound exceeded; nothing truncated",
    );
    differences.push(item);
  }
  const result = {
    schemaVersion: 1,
    purpose: PURPOSE,
    context: first.pinned,
    before: { ...before.aggregate },
    after: { ...after.aggregate },
    beforeDetailSha256: before.detailSha256,
    afterDetailSha256: after.detailSha256,
    netEntries: after.aggregate.entries - before.aggregate.entries,
    netBytes: after.aggregate.bytes - before.aggregate.bytes,
    differences,
    differenceBytes,
    differencesSha256: hash(JSON.stringify(differences)),
    complete: true,
    acceptance: { ...ACCEPTANCE },
    limitations: [
      "Externally verified parent pins are required; this observer grants no authority.",
      "Directory/symlink modes are not part of the original native identity.",
      "Path/type/file-mode/size/hash/link-target metadata only; source bodies are never returned.",
      "Net counts do not establish the number of deleted files or the cause of changes.",
    ],
  };
  assert.ok(
    Buffer.byteLength(JSON.stringify(result)) <= bounds.differenceBytes,
    "Complete difference metadata bound exceeded; nothing truncated",
  );
  return result;
}
