// Pure request preparation only. Nothing here starts a build, changes IAM, or
// confers native/runtime acceptance. Expected artifact bytes come from the
// independently pinned Git source ZIP, never the candidate image's own claims.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const MAX_ARCHIVE = 30 * 1024 * 1024;
const MAX_SCRIPT = 1024 * 1024;
const MAX_SELECTED = 8 * MAX_SCRIPT;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decode = new TextDecoder("utf-8", { fatal: true });

function validateExtra(bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    assert.ok(offset + 4 <= bytes.length, "Truncated ZIP extra header refused");
    const kind = bytes.readUInt16LE(offset), size = bytes.readUInt16LE(offset + 2);
    assert.notEqual(kind, 1, "ZIP64 extra metadata refused");
    offset += 4;
    assert.ok(offset + size <= bytes.length, "Truncated ZIP extra data refused");
    offset += size;
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Inspect Git ZIP entries in memory; never extract paths or execute content. */
export function readGitArchiveScripts(archive, commit, scripts, gitModes) {
  assert.ok(Buffer.isBuffer(archive), "Binary ZIP bytes required");
  assert.ok(archive.length >= 22 && archive.length <= MAX_ARCHIVE);
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.ok(Array.isArray(scripts) && scripts.length > 0 && scripts.length <= 32);
  assert.equal(new Set(scripts).size, scripts.length, "Unique scripts required");
  for (const name of scripts) assert.match(name, /^[a-zA-Z0-9_.-]+$/);
  const selected = new Set(scripts.map((name) => `scripts/${name}`));

  let end = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65557); offset--) {
    if (archive.readUInt32LE(offset) === 0x06054b50 &&
        offset + 22 + archive.readUInt16LE(offset + 20) === archive.length) {
      end = offset;
      break;
    }
  }
  assert.ok(end >= 0, "Bounded ZIP directory required");
  assert.equal(archive.readUInt16LE(end + 4), 0, "Multi-disk ZIP refused");
  assert.equal(archive.readUInt16LE(end + 6), 0);
  const count = archive.readUInt16LE(end + 10);
  assert.ok(count > 0 && count < 20000, "Bounded non-ZIP64 entry count required");
  assert.equal(archive.readUInt16LE(end + 8), count);
  const directorySize = archive.readUInt32LE(end + 12);
  const directoryStart = archive.readUInt32LE(end + 16);
  assert.equal(directoryStart + directorySize, end);
  assert.equal(decode.decode(archive.subarray(end + 22)), commit, "Git archive commit comment required");

  let offset = directoryStart;
  let selectedBytes = 0;
  const names = new Set();
  const intervals = [];
  const output = new Map();
  for (let index = 0; index < count; index++) {
    assert.ok(offset + 46 <= end);
    assert.equal(archive.readUInt32LE(offset), 0x02014b50);
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    assert.equal(flags & ~0x080e, 0, "Encrypted/unsupported ZIP flags refused");
    assert.ok(method === 0 || method === 8, "Stored/deflated ZIP entries only");
    if (method === 0) assert.equal(flags & 6, 0, "Stored entry compression flags refused");
    const checksum = archive.readUInt32LE(offset + 16);
    const compressed = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    assert.ok(compressed < 0xffffffff && size < 0xffffffff, "ZIP64 refused");
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    assert.equal(archive.readUInt16LE(offset + 34), 0);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    assert.ok(nameLength > 0 && nameLength <= 1024 && next <= end);
    const nameBytes = archive.subarray(offset + 46, offset + 46 + nameLength);
    validateExtra(archive.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength));
    const name = decode.decode(nameBytes);
    assert.ok(!name.includes("\\") && !name.includes("\0") && !name.startsWith("/") &&
      !/^[a-zA-Z]:/.test(name) && !name.split("/").some((part, i, all) =>
        part === "." || part === ".." || part === "" && i !== all.length - 1), "Unsafe ZIP path refused");
    assert.ok(!names.has(name), "Duplicate ZIP path refused");
    names.add(name);
    const local = archive.readUInt32LE(offset + 42);
    assert.ok(local + 30 <= directoryStart);
    assert.equal(archive.readUInt32LE(local), 0x04034b50);
    assert.equal(archive.readUInt16LE(local + 6), flags);
    assert.equal(archive.readUInt16LE(local + 8), method);
    const localNameLength = archive.readUInt16LE(local + 26);
    const localExtraLength = archive.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressed;
    assert.ok(dataEnd <= directoryStart);
    assert.ok(archive.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes));
    validateExtra(archive.subarray(local + 30 + localNameLength, dataStart));
    let entryEnd = dataEnd;
    if (!(flags & 8)) {
      assert.equal(archive.readUInt32LE(local + 14), checksum);
      assert.equal(archive.readUInt32LE(local + 18), compressed);
      assert.equal(archive.readUInt32LE(local + 22), size);
    } else {
      // Streamed Git ZIPs can carry either signed or unsigned descriptors.
      // Validate the actual descriptor and include it in overlap detection.
      for (const [position, expected] of [[14, checksum], [18, compressed], [22, size]]) {
        const stored = archive.readUInt32LE(local + position);
        assert.ok(stored === 0 || stored === expected, "Local descriptor metadata mismatch");
      }
      assert.ok(dataEnd + 12 <= directoryStart, "Missing ZIP data descriptor");
      const signed = archive.readUInt32LE(dataEnd) === 0x08074b50;
      const descriptor = dataEnd + (signed ? 4 : 0);
      entryEnd = descriptor + 12;
      assert.ok(entryEnd <= directoryStart, "Truncated ZIP data descriptor");
      assert.equal(archive.readUInt32LE(descriptor), checksum, "ZIP descriptor CRC mismatch");
      assert.equal(archive.readUInt32LE(descriptor + 4), compressed, "ZIP descriptor size mismatch");
      assert.equal(archive.readUInt32LE(descriptor + 8), size, "ZIP descriptor size mismatch");
    }
    intervals.push([local, entryEnd]);
    if (selected.has(name)) {
      const attributes = archive.readUInt32LE(offset + 38), mode = attributes >>> 16;
      const scriptName = name.slice("scripts/".length);
      // Windows Git emits ordinary100644 files with DOS/no mode metadata.
      // Accept only when an independently read exact Git tree supplies that mode;
      // never infer regular-file identity from a mode-less candidate's own bytes.
      if (mode === 0 && attributes === 0 && archive.readUInt16LE(offset + 4) === 0) {
        assert.equal(gitModes?.get(scriptName), "100644", "Mode-less archive script requires exact regular Git tree mode");
      } else {
        assert.equal(mode & 0xf000, 0x8000, "Selected script must be a regular Git file");
        if (gitModes?.has(scriptName)) assert.equal(mode.toString(8), gitModes.get(scriptName), "Archive/Git tree mode mismatch");
      }
      assert.ok(size <= MAX_SCRIPT, "Oversized selected script refused");
      selectedBytes += size;
      assert.ok(selectedBytes <= MAX_SELECTED);
      const packed = archive.subarray(dataStart, dataEnd);
      const bytes = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: MAX_SCRIPT });
      assert.equal(bytes.length, size);
      assert.equal(crc32(bytes), checksum, "ZIP CRC mismatch");
      output.set(name.slice("scripts/".length), bytes);
    }
    offset = next;
  }
  assert.equal(offset, end);
  intervals.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < intervals.length; i++)
    assert.ok(intervals[i - 1][1] <= intervals[i][0], "Overlapping ZIP entries refused");
  assert.equal(output.size, scripts.length, "Every selected script must exist");
  return output;
}

/** Bind image checks to the exact pinned ZIP, not normalized candidate bytes. */
export function prepareArchiveScriptIdentity({ archive, archiveSha256, commit, scripts, gitBlob, gitExport, gitMode }) {
  assert.match(archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(sha256(archive), archiveSha256, "Immutable source ZIP hash required");
  assert.equal(typeof gitBlob, "function");
  assert.equal(typeof gitExport, "function");
  const gitModes = new Map();
  if (gitMode !== undefined) {
    assert.equal(typeof gitMode, "function");
    for (const name of scripts) {
      const mode = gitMode(name);
      assert.ok(mode === "100644" || mode === "100755", "Exact regular Git tree entry required");
      gitModes.set(name, mode);
    }
  }
  const entries = readGitArchiveScripts(archive, commit, scripts, gitModes);
  const expectedScripts = Object.create(null);
  const sourceBindings = Object.create(null);
  for (const name of scripts) {
    const bytes = entries.get(name);
    const blob = gitBlob(name);
    assert.ok(Buffer.isBuffer(blob) && blob.length <= MAX_SCRIPT);
    let transform = "identical";
    if (!bytes.equals(blob)) {
      // An export transformation is accepted only if fresh Git export reproduces
      // these exact immutable bytes AND the sole difference is deterministic EOL.
      const reproduced = readGitArchiveScripts(gitExport(name), commit, [name], gitModes).get(name);
      assert.ok(bytes.equals(reproduced), "Pinned bytes must match deterministic Git export");
      const text = decode.decode(blob); // Never treat lossy UTF-8 replacement as EOL provenance.
      const lfToCrlf = Buffer.from(text.replace(/(?<!\r)\n/g, "\r\n"));
      const crlfToLf = Buffer.from(text.replaceAll("\r\n", "\n"));
      assert.ok(bytes.equals(lfToCrlf) || bytes.equals(crlfToLf), "Non-EOL source transformation refused");
      transform = bytes.equals(lfToCrlf) ? "git-export-lf-to-crlf" : "git-export-crlf-to-lf";
    }
    expectedScripts[name] = sha256(bytes);
    sourceBindings[name] = { archiveSha256: sha256(bytes), archiveBytes: bytes.length,
      gitBlobSha256: sha256(blob), gitBlobBytes: blob.length, transform,
      ...(gitModes.has(name) ? { gitMode: gitModes.get(name) } : {}) };
  }
  return { expectedScripts, sourceBindings };
}

const shellQuote = (text) => "'" + text.replaceAll("'", "'\\''") + "'";

/** CodeBuild command scopes vary; ownership, trap and operation share one Bash. */
export function nativeValidationShell(commands) {
  assert.ok(Array.isArray(commands) && commands.length > 0 && commands.length <= 64);
  for (const command of commands)
    assert.ok(typeof command === "string" && command.length > 0 && command.length <= 128 * 1024 && !command.includes("\0"));
  const script = [
    "set -eu -o pipefail",
    "native_validation_container=''",
    "cleanup_native_validation() {",
    "  case \"$native_validation_container\" in",
    "    '') return 0 ;;",
    "    *[!0-9a-f]*) return 70 ;;",
    "  esac",
    "  test \"${#native_validation_container}\" = 64 || return 70",
    "  timeout 20s docker rm -f \"$native_validation_container\" >/dev/null",
    "}",
    "trap 'native_status=$?; trap - EXIT; if ! cleanup_native_validation; then if test \"$native_status\" = 0; then native_status=70; fi; fi; exit \"$native_status\"' EXIT",
    ...commands,
  ].join("\n");
  assert.ok(Buffer.byteLength(script) <= 512 * 1024);
  return `bash -eu -o pipefail -c ${shellQuote(script)}`;
}
