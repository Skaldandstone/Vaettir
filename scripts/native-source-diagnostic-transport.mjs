// Public native metadata ONLY. This codec cannot authorize a native phase,
// publish an image, execute compiler input, or touch native/host filesystems.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, inflateRawSync } from "node:zlib";
import { diffNativeSourceInventories } from "./native-source-inventory-observer.mjs";

export const NATIVE_SOURCE_DIAGNOSTIC_PREFIX =
  "PUBLIC_NATIVE_SOURCE_DIAGNOSTIC_CHUNK=";
export const NATIVE_SOURCE_DIAGNOSTIC_LIMITS = Object.freeze({
  snapshotBytes: 64 * 1024 ** 2,
  differenceBytes: 1024 ** 2,
  chunkBytes: 128 * 1024,
  lineBytes: 180 * 1024,
  compressedBytes: 32 * 1024 ** 2,
  framedLogBytes: 48 * 1024 ** 2,
  publicLogBytes: 64 * 1024 ** 2,
  frames: 4096,
});
const PURPOSE = "public-native-source-integrity-diagnostic";
const SHA = /^[a-f0-9]{64}$/;
const ACCEPTANCE = Object.freeze({
  nativePhaseAccepted: false,
  unitSuitesAccepted: false,
  packageAccepted: false,
  runtimeAccepted: false,
  deploymentAccepted: false,
});
const kinds = ["BEFORE", "AFTER", "DIFF"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function keys(value, expected) {
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  assert.equal(Object.getOwnPropertySymbols(value).length, 0);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  ))
    assert.ok("value" in descriptor);
}
function integer(value, max, min = 0) {
  assert.ok(Number.isSafeInteger(value) && value >= min && value <= max);
}
function scopeOf(value) {
  keys(value, [
    "schemaVersion",
    "purpose",
    "sourceCommit",
    "sourceArchiveSha256",
    "parentImageDigest",
    "parentImageConfigDigest",
    "parentReceiptSha256",
    "observerSha256",
    "diagnosticPlanSha256",
    "expectedSource",
  ]);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.purpose, PURPOSE);
  assert.match(value.sourceCommit, /^[a-f0-9]{40}$/);
  for (const key of [
    "sourceArchiveSha256",
    "parentReceiptSha256",
    "observerSha256",
    "diagnosticPlanSha256",
  ])
    assert.match(value[key], SHA);
  for (const key of ["parentImageDigest", "parentImageConfigDigest"])
    assert.match(value[key], /^sha256:[a-f0-9]{64}$/);
  keys(value.expectedSource, ["sha256", "entries", "bytes"]);
  assert.match(value.expectedSource.sha256, SHA);
  integer(value.expectedSource.entries, 400000);
  integer(value.expectedSource.bytes, 64 * 1024 ** 3);
  return value;
}
function contextOf(scope) {
  return {
    schemaVersion: 1,
    purpose: PURPOSE,
    sourceRoot: "/build/llvm-source",
    parentImageDigest: scope.parentImageDigest,
    parentReceiptSha256: scope.parentReceiptSha256,
    expectedSource: { ...scope.expectedSource },
  };
}
// Exact UTF8 JSON with sorted object keys; arrays retain original native DFS
// vector order. Reject nonplain/accessor/sparse/cyclic/unsupported values.
function canonicalJson(value) {
  let nodes = 0;
  const seen = new Set();
  function visit(item, depth) {
    assert.ok(
      ++nodes <= 6000000 && depth <= 64,
      "Bounded canonical metadata required",
    );
    if (item === null || typeof item === "boolean" || typeof item === "string")
      return item;
    if (typeof item === "number") {
      assert.ok(Number.isSafeInteger(item));
      return item;
    }
    assert.ok(
      item && typeof item === "object" && !seen.has(item),
      "Unsupported/cyclic metadata",
    );
    seen.add(item);
    assert.equal(Object.getOwnPropertySymbols(item).length, 0);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const descriptor of Object.values(descriptors))
      assert.ok("value" in descriptor);
    let result;
    if (Array.isArray(item)) {
      assert.equal(Object.getPrototypeOf(item), Array.prototype);
      assert.deepEqual(
        Object.keys(item),
        Array.from({ length: item.length }, (_, index) => String(index)),
      );
      result = item.map((child) => visit(child, depth + 1));
    } else {
      assert.equal(Object.getPrototypeOf(item), Object.prototype);
      result = Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((name) => [name, visit(item[name], depth + 1)]),
      );
    }
    seen.delete(item);
    return result;
  }
  return JSON.stringify(visit(value, 0));
}
function verifiedObjects(objects, scope) {
  keys(objects, ["before", "after", "difference"]);
  const context = contextOf(scope);
  assert.deepEqual(objects.before.context, context);
  assert.deepEqual(objects.after.context, context);
  // The ACTUAL observer independently validates both complete original vectors,
  // aggregates/DFSort/types/exclusions/false acceptance, then derives all diffs.
  const derived = diffNativeSourceInventories(objects.before, objects.after);
  assert.deepEqual(
    objects.difference,
    derived,
    "Complete independently derived difference required",
  );
  return { BEFORE: objects.before, AFTER: objects.after, DIFF: derived };
}
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function decodeMember(compressed, rawBytes) {
  integer(rawBytes, NATIVE_SOURCE_DIAGNOSTIC_LIMITS.chunkBytes, 1);
  assert.ok(
    compressed.length >= 18 && compressed.length <= rawBytes + 128,
    "Bounded gzip member required",
  );
  // Fixed gzip header from builtin gzip(level9), no filenames/optional fields.
  assert.deepEqual(
    [...compressed.subarray(0, 10)],
    [31, 139, 8, 0, 0, 0, 0, 0, 2, 3],
  );
  assert.equal(
    compressed.readUInt32LE(compressed.length - 4),
    rawBytes,
    "Exact gzip original size required",
  );
  const deflate = compressed.subarray(10, -8);
  const decoded = inflateRawSync(deflate, {
    maxOutputLength: rawBytes,
    info: true,
  });
  assert.equal(
    decoded.engine.bytesWritten,
    deflate.length,
    "Trailing deflate bytes or gzip members refused",
  );
  assert.equal(decoded.buffer.length, rawBytes);
  assert.equal(
    compressed.readUInt32LE(compressed.length - 8),
    crc32(decoded.buffer),
    "Gzip CRC mismatch",
  );
  return decoded.buffer;
}
function canonicalGzip(bytes) {
  const encoded = gzipSync(bytes, { level: 9 });
  // zlib's OS header byte is10 on Windows and3 on Linux. Normalize ONLY
  // this metadata-container hint; no native source/CRC/deflate bytes change.
  encoded[9] = 3;
  return encoded;
}
const frameKeys = [
  "schemaVersion",
  "purpose",
  "scope",
  "kind",
  "index",
  "chunks",
  "chunkBytes",
  "rawBytes",
  "gzipBytes",
  "rawSha256",
  "gzipSha256",
  "objectBytes",
  "objectSha256",
  "objectCompressedBytes",
  "objectCompressedSha256",
  "gzipBase64",
];

export function encodeNativeSourceDiagnosticTransport(objects, externalScope) {
  const scope = scopeOf(externalScope),
    verified = verifiedObjects(objects, scope),
    lines = [];
  let totalCompressed = 0,
    totalFramed = 0;
  for (const kind of kinds) {
    const raw = Buffer.from(canonicalJson(verified[kind]), "utf8"),
      cap =
        kind === "DIFF"
          ? NATIVE_SOURCE_DIAGNOSTIC_LIMITS.differenceBytes
          : NATIVE_SOURCE_DIAGNOSTIC_LIMITS.snapshotBytes;
    assert.ok(
      raw.length > 0 && raw.length <= cap,
      "Complete metadata object exceeds bound; nothing truncated",
    );
    const blocks = [];
    for (
      let offset = 0;
      offset < raw.length;
      offset += NATIVE_SOURCE_DIAGNOSTIC_LIMITS.chunkBytes
    ) {
      const bytes = raw.subarray(
          offset,
          offset + NATIVE_SOURCE_DIAGNOSTIC_LIMITS.chunkBytes,
        ),
        gzip = canonicalGzip(bytes);
      assert.deepEqual(decodeMember(gzip, bytes.length), bytes);
      blocks.push({ bytes, gzip });
    }
    const compressed = Buffer.concat(blocks.map((block) => block.gzip));
    const objectSha256 = sha(raw),
      objectCompressedSha256 = sha(compressed);
    totalCompressed += compressed.length;
    assert.ok(
      totalCompressed <= NATIVE_SOURCE_DIAGNOSTIC_LIMITS.compressedBytes,
      "Complete compressed aggregate exceeds bound",
    );
    for (const [index, block] of blocks.entries()) {
      const frame = {
        schemaVersion: 1,
        purpose: PURPOSE,
        scope,
        kind,
        index,
        chunks: blocks.length,
        chunkBytes: NATIVE_SOURCE_DIAGNOSTIC_LIMITS.chunkBytes,
        rawBytes: block.bytes.length,
        gzipBytes: block.gzip.length,
        rawSha256: sha(block.bytes),
        gzipSha256: sha(block.gzip),
        objectBytes: raw.length,
        objectSha256,
        objectCompressedBytes: compressed.length,
        objectCompressedSha256,
        gzipBase64: block.gzip.toString("base64"),
      };
      const line = NATIVE_SOURCE_DIAGNOSTIC_PREFIX + canonicalJson(frame);
      assert.ok(
        Buffer.byteLength(line) <= NATIVE_SOURCE_DIAGNOSTIC_LIMITS.lineBytes,
      );
      totalFramed += Buffer.byteLength(line) + 1;
      assert.ok(
        totalFramed <= NATIVE_SOURCE_DIAGNOSTIC_LIMITS.framedLogBytes &&
          lines.length < NATIVE_SOURCE_DIAGNOSTIC_LIMITS.frames,
      );
      lines.push(line);
    }
  }
  return lines;
}

export function decodeNativeSourceDiagnosticTransport(lines, externalScope) {
  const scope = scopeOf(externalScope),
    objects = {};
  assert.ok(
    Array.isArray(lines) &&
      Object.getPrototypeOf(lines) === Array.prototype &&
      lines.length >= 3 &&
      lines.length <= NATIVE_SOURCE_DIAGNOSTIC_LIMITS.frames,
  );
  assert.deepEqual(
    Object.keys(lines),
    Array.from({ length: lines.length }, (_, index) => String(index)),
  );
  let cursor = 0,
    totalCompressed = 0,
    totalFramed = 0;
  for (const kind of kinds) {
    const rawChunks = [],
      gzipChunks = [];
    let object;
    for (let index = 0; !object || index < object.chunks; index++) {
      assert.ok(cursor < lines.length, "Missing complete metadata chunks");
      const line = lines[cursor++];
      assert.ok(
        typeof line === "string" &&
          line.startsWith(NATIVE_SOURCE_DIAGNOSTIC_PREFIX),
      );
      integer(
        Buffer.byteLength(line),
        NATIVE_SOURCE_DIAGNOSTIC_LIMITS.lineBytes,
        1,
      );
      totalFramed += Buffer.byteLength(line) + 1;
      assert.ok(totalFramed <= NATIVE_SOURCE_DIAGNOSTIC_LIMITS.framedLogBytes);
      const encoded = line.slice(NATIVE_SOURCE_DIAGNOSTIC_PREFIX.length),
        frame = JSON.parse(encoded);
      keys(frame, frameKeys);
      assert.equal(
        canonicalJson(frame),
        encoded,
        "Noncanonical frame JSON refused",
      );
      assert.equal(frame.schemaVersion, 1);
      assert.equal(frame.purpose, PURPOSE);
      assert.deepEqual(scopeOf(frame.scope), scope);
      assert.equal(frame.kind, kind);
      assert.equal(frame.index, index);
      integer(frame.chunkBytes, NATIVE_SOURCE_DIAGNOSTIC_LIMITS.chunkBytes, 1);
      integer(
        frame.objectBytes,
        kind === "DIFF"
          ? NATIVE_SOURCE_DIAGNOSTIC_LIMITS.differenceBytes
          : NATIVE_SOURCE_DIAGNOSTIC_LIMITS.snapshotBytes,
        1,
      );
      integer(frame.chunks, NATIVE_SOURCE_DIAGNOSTIC_LIMITS.frames, 1);
      assert.equal(
        frame.chunks,
        Math.ceil(frame.objectBytes / frame.chunkBytes),
      );
      integer(
        frame.objectCompressedBytes,
        NATIVE_SOURCE_DIAGNOSTIC_LIMITS.compressedBytes,
        1,
      );
      integer(frame.rawBytes, frame.chunkBytes, 1);
      assert.equal(
        frame.rawBytes,
        index === frame.chunks - 1
          ? frame.objectBytes - index * frame.chunkBytes
          : frame.chunkBytes,
      );
      integer(frame.gzipBytes, frame.rawBytes + 128, 18);
      for (const key of [
        "rawSha256",
        "gzipSha256",
        "objectSha256",
        "objectCompressedSha256",
      ])
        assert.match(frame[key], SHA);
      const identity = {
        chunks: frame.chunks,
        chunkBytes: frame.chunkBytes,
        objectBytes: frame.objectBytes,
        objectSha256: frame.objectSha256,
        objectCompressedBytes: frame.objectCompressedBytes,
        objectCompressedSha256: frame.objectCompressedSha256,
      };
      if (!object) object = identity;
      else assert.deepEqual(identity, object, "Mixed object chunks refused");
      assert.ok(
        typeof frame.gzipBase64 === "string" &&
          /^[A-Za-z0-9+/]+={0,2}$/.test(frame.gzipBase64),
      );
      const gzip = Buffer.from(frame.gzipBase64, "base64");
      assert.equal(
        gzip.toString("base64"),
        frame.gzipBase64,
        "Noncanonical base64 refused",
      );
      assert.equal(gzip.length, frame.gzipBytes);
      assert.equal(sha(gzip), frame.gzipSha256);
      totalCompressed += gzip.length;
      assert.ok(
        totalCompressed <= NATIVE_SOURCE_DIAGNOSTIC_LIMITS.compressedBytes,
      );
      const raw = decodeMember(gzip, frame.rawBytes);
      assert.equal(sha(raw), frame.rawSha256);
      rawChunks.push(raw);
      gzipChunks.push(gzip);
    }
    const compressed = Buffer.concat(gzipChunks),
      raw = Buffer.concat(rawChunks);
    assert.equal(compressed.length, object.objectCompressedBytes);
    assert.equal(sha(compressed), object.objectCompressedSha256);
    assert.equal(raw.length, object.objectBytes);
    assert.equal(sha(raw), object.objectSha256);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw),
      parsed = JSON.parse(text);
    assert.equal(
      canonicalJson(parsed),
      text,
      "Noncanonical complete object JSON refused",
    );
    objects[kind] = parsed;
  }
  assert.equal(cursor, lines.length, "Extra/replayed metadata frames refused");
  const payload = {
    before: objects.BEFORE,
    after: objects.AFTER,
    difference: objects.DIFF,
  };
  verifiedObjects(payload, scope);
  return { scope, ...payload, complete: true, acceptance: { ...ACCEPTANCE } };
}
