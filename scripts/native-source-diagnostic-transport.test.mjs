import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { test } from "node:test";
import { diffNativeSourceInventories } from "./native-source-inventory-observer.mjs";
import {
  encodeNativeSourceDiagnosticTransport as encode,
  decodeNativeSourceDiagnosticTransport as decode,
  NATIVE_SOURCE_DIAGNOSTIC_PREFIX as prefix,
  NATIVE_SOURCE_DIAGNOSTIC_LIMITS as limits,
} from "./native-source-diagnostic-transport.mjs";

// Pure synthetic PUBLIC metadata only: no native source, file IO, shell,
// compiler, credentials, Docker, network, database or cloud operations.
const sha = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sort(value[key])]),
    );
  return value;
}
const acceptance = {
  nativePhaseAccepted: false,
  unitSuitesAccepted: false,
  packageAccepted: false,
  runtimeAccepted: false,
  deploymentAccepted: false,
};
function snapshot(records, stage, context) {
  const aggregate = {
    sha256: sha(records.map((row) => JSON.stringify(row) + "\n").join("")),
    entries: records.length,
    bytes: records.reduce(
      (sum, row) => sum + (row[1] === "file" ? row[3] : 0),
      0,
    ),
  };
  const vector = JSON.stringify(records);
  return {
    schemaVersion: 1,
    context,
    stage,
    aggregate,
    detailSha256: sha(vector),
    detailBytes: Buffer.byteLength(vector),
    records,
    complete: true,
    acceptance: { ...acceptance },
  };
}
function fixture(count = 1) {
  const records = [["llvm", "directory"]];
  for (let index = 0; index < count; index++)
    records.push([
      `llvm/unit-${String(index).padStart(5, "0")}.cpp`,
      "file",
      0o644,
      index + 1,
      sha(`public-synthetic-${index}`),
    ]);
  const expectedSource = snapshot(records, "BEFORE", {}).aggregate;
  const scope = {
    schemaVersion: 1,
    purpose: "public-native-source-integrity-diagnostic",
    sourceCommit: "1".repeat(40),
    sourceArchiveSha256: "2".repeat(64),
    parentImageDigest: "sha256:" + "3".repeat(64),
    parentImageConfigDigest: "sha256:" + "4".repeat(64),
    parentReceiptSha256: "5".repeat(64),
    observerSha256: "6".repeat(64),
    diagnosticPlanSha256: "7".repeat(64),
    expectedSource,
  };
  const context = {
    schemaVersion: 1,
    purpose: scope.purpose,
    sourceRoot: "/build/llvm-source",
    parentImageDigest: scope.parentImageDigest,
    parentReceiptSha256: scope.parentReceiptSha256,
    expectedSource,
  };
  const afterRecords = clone(records);
  afterRecords.at(-1)[2] = 0o600;
  const before = snapshot(records, "BEFORE", context),
    after = snapshot(afterRecords, "AFTER", context);
  const objects = {
    before,
    after,
    difference: diffNativeSourceInventories(before, after),
  };
  return { scope, objects, lines: encode(objects, scope) };
}
const parse = (line) => JSON.parse(line.slice(prefix.length));
const render = (frame) => prefix + canonical(frame);
function changeFrame(lines, index, mutate) {
  const result = [...lines],
    frame = parse(result[index]);
  mutate(frame);
  result[index] = render(frame);
  return result;
}
function replaceSingleMember(frame, raw, gzip = gzipSync(raw, { level: 9 })) {
  assert.equal(frame.chunks, 1);
  gzip[9] = 3; // Match actual canonical cross-platform metadata header.
  frame.rawBytes = raw.length;
  frame.objectBytes = raw.length;
  frame.rawSha256 = sha(raw);
  frame.objectSha256 = sha(raw);
  frame.gzipBytes = gzip.length;
  frame.objectCompressedBytes = gzip.length;
  frame.gzipSha256 = sha(gzip);
  frame.objectCompressedSha256 = sha(gzip);
  frame.gzipBase64 = gzip.toString("base64");
}

test("roundtrips complete independent original vectors and exact reviewed differences with every acceptance false", () => {
  const { scope, objects, lines } = fixture();
  const result = decode(lines, scope);
  assert.deepEqual(result, { scope, ...objects, complete: true, acceptance });
  assert.equal(result.difference.differences[0].changedFields[0], "mode");
  for (const line of lines)
    assert.ok(Buffer.byteLength(line) <= limits.lineBytes);
  assert.equal(Buffer.from(parse(lines[0]).gzipBase64, "base64")[9], 3);
});
test("multi-chunk vectors retain native DFS order and refuse missing duplicate reordered or extra frames", () => {
  const { scope, objects, lines } = fixture(3000);
  assert.ok(parse(lines[0]).chunks > 1);
  assert.deepEqual(decode(lines, scope).before, objects.before);
  for (const damaged of [
    lines.slice(1),
    [...lines, lines[0]],
    [lines[0], ...lines],
    [lines[1], lines[0], ...lines.slice(2)],
    [...lines.slice(0, 1), ...lines.slice(2)],
  ])
    assert.throws(() => decode(damaged, scope));
});
test("binds all externally reviewed archive core configuration receipt observer plan and expected source pins", () => {
  const { scope, lines } = fixture();
  for (const key of [
    "sourceCommit",
    "sourceArchiveSha256",
    "parentImageDigest",
    "parentImageConfigDigest",
    "parentReceiptSha256",
    "observerSha256",
    "diagnosticPlanSha256",
  ]) {
    const changed = clone(scope);
    changed[key] = key.endsWith("Digest")
      ? "sha256:" + "a".repeat(64)
      : "a".repeat(key === "sourceCommit" ? 40 : 64);
    assert.throws(() => decode(lines, changed));
  }
  const changed = clone(scope);
  changed.expectedSource.bytes++;
  assert.throws(() => decode(lines, changed));
  assert.throws(() =>
    decode(
      changeFrame(
        lines,
        1,
        (frame) => (frame.scope.diagnosticPlanSha256 = "a".repeat(64)),
      ),
      scope,
    ),
  );
});
test("rejects replayed/mixed control and object-kind/index/full-hash/byte-count ambiguity", () => {
  const { scope, lines } = fixture();
  const mutations = [
    (frame) => (frame.kind = "AFTER"),
    (frame) => frame.index++,
    (frame) => (frame.objectSha256 = "a".repeat(64)),
    (frame) => (frame.objectCompressedSha256 = "a".repeat(64)),
    (frame) => frame.objectBytes++,
    (frame) => frame.objectCompressedBytes++,
    (frame) => (frame.acceptance = { nativePhaseAccepted: true }),
    (frame) => (frame.purpose = "accepted-native-phase"),
  ];
  for (const mutate of mutations)
    assert.throws(() => decode(changeFrame(lines, 0, mutate), scope));
  assert.throws(() => decode([...lines].reverse(), scope));
});
test("rejects noncanonical frame JSON, duplicate keys, noncanonical base64, whitespace and unframed lines", () => {
  const { scope, lines } = fixture();
  const text = lines[0].slice(prefix.length);
  for (const first of [
    prefix + " " + text,
    prefix + text.replace('"index":0', '"index":0,"index":0'),
    "unexpected public log line",
  ])
    assert.throws(() => decode([first, ...lines.slice(1)], scope));
  assert.throws(() =>
    decode(
      changeFrame(lines, 0, (frame) => (frame.gzipBase64 += "\n")),
      scope,
    ),
  );
  assert.throws(() =>
    decode(
      changeFrame(lines, 0, (frame) => (frame.gzipBase64 += "=")),
      scope,
    ),
  );
});
test("rejects genuine gzip CRC and original-size changes even if outer compressed hashes are recomputed", () => {
  const { scope, lines } = fixture();
  for (const position of [-8, -4])
    assert.throws(() =>
      decode(
        changeFrame(lines, 0, (frame) => {
          const gzip = Buffer.from(frame.gzipBase64, "base64");
          gzip[gzip.length + position] ^= 1;
          frame.gzipBase64 = gzip.toString("base64");
          frame.gzipSha256 = sha(gzip);
          frame.objectCompressedSha256 = sha(gzip);
        }),
        scope,
      ),
    );
});
test("rejects appended gzip members and trailing deflate data without accepting concatenation", () => {
  const { scope, lines } = fixture();
  assert.throws(() =>
    decode(
      changeFrame(lines, 0, (frame) => {
        const first = Buffer.from(frame.gzipBase64, "base64"),
          raw = gunzipSync(first);
        const appended = Buffer.concat([
          first,
          gzipSync(Buffer.from("synthetic-trailing-member"), { level: 9 }),
        ]);
        // Deliberately rebind outer hashes and final trailer length: inflater must
        // still refuse first-member unused trailing bytes, not merely a stale hash.
        appended.writeUInt32LE(raw.length, appended.length - 4);
        replaceSingleMember(frame, raw, appended);
      }),
      scope,
    ),
  );
});
test("refuses a high-expansion gzip bomb under declared chunk byte bound", () => {
  const { scope, lines } = fixture();
  assert.throws(() =>
    decode(
      changeFrame(lines, 0, (frame) => {
        const small = gunzipSync(Buffer.from(frame.gzipBase64, "base64")),
          bomb = gzipSync(Buffer.alloc(1024 * 1024, 65), { level: 9 });
        bomb.writeUInt32LE(small.length, bomb.length - 4);
        replaceSingleMember(frame, small, bomb);
      }),
      scope,
    ),
  );
});
test("refuses invalid UTF8 and noncanonical complete JSON after correct outer gzip and SHA framing", () => {
  const { scope, lines } = fixture();
  for (const raw of [
    Buffer.from([0xc3, 0x28]),
    Buffer.from(
      " " +
        gunzipSync(
          Buffer.from(parse(lines[0]).gzipBase64, "base64"),
        ).toString(),
    ),
  ]) {
    assert.throws(() =>
      decode(
        changeFrame(lines, 0, (frame) => replaceSingleMember(frame, raw)),
        scope,
      ),
    );
  }
});
test("independently derives diff and rejects omitted false flags, incomplete vectors and forged aggregate or delta", () => {
  const { scope, objects } = fixture();
  for (const mutate of [
    (value) => (value.before.complete = false),
    (value) => (value.before.acceptance.runtimeAccepted = true),
    (value) => value.before.records.pop(),
    (value) => (value.before.aggregate.sha256 = "a".repeat(64)),
    (value) => (value.difference.differences = []),
    (value) => (value.difference.netBytes = 1),
  ]) {
    const value = clone(objects);
    mutate(value);
    assert.throws(() => encode(value, scope));
  }
  const good = encode(objects, scope);
  assert.throws(() =>
    decode(
      changeFrame(good, good.length - 1, (frame) => {
        const delta = JSON.parse(
          gunzipSync(Buffer.from(frame.gzipBase64, "base64")),
        );
        delta.differences = [];
        replaceSingleMember(frame, Buffer.from(canonical(delta)));
      }),
      scope,
    ),
  );
});
test("refuses oversized controls, sparse/unsupported values and extra objects rather than truncating", () => {
  const { scope, objects, lines } = fixture();
  assert.throws(() =>
    decode(
      changeFrame(
        lines,
        0,
        (frame) => (frame.objectBytes = limits.snapshotBytes + 1),
      ),
      scope,
    ),
  );
  assert.throws(() =>
    decode(
      changeFrame(
        lines,
        0,
        (frame) => (frame.objectCompressedBytes = limits.compressedBytes + 1),
      ),
      scope,
    ),
  );
  assert.throws(() =>
    decode(
      changeFrame(lines, 0, (frame) => (frame.chunks = limits.frames + 1)),
      scope,
    ),
  );
  assert.throws(() =>
    decode([prefix + "x".repeat(limits.lineBytes), ...lines.slice(1)], scope),
  );
  const sparse = [...lines];
  delete sparse[0];
  assert.throws(() => decode(sparse, scope));
  assert.throws(() => encode({ ...objects, extra: {} }, scope));
  const bad = clone(scope);
  Object.defineProperty(bad, "sourceCommit", {
    get() {
      throw Error("Accessor must not execute");
    },
    enumerable: true,
  });
  assert.throws(() => encode(objects, bad));
});
