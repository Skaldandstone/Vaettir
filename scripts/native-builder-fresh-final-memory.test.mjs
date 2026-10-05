// Synthetic fixed-path IO only; never reads actual cgroups or executes native work.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readNativeFinalMemory, createNativeFreshFinalAdapter } from "./native-builder-fresh-final-adapter.mjs";

const paths = ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes"];
const GB = 1024 ** 3;
function fixture(values) {
  const nodes = new Map(Object.entries(values).map(([path, value], index) => [path, { bytes: Buffer.from(value), ino: index + 1, dev: 1, mode: 0o100644, uid: 0, mtimeMs: 1, ctimeMs: 1, size: 0, symlink: false }]));
  const fds = new Map(), calls = []; let next = 1;
  const stat = n => ({ ...n, isFile: () => !n.symlink, isSymbolicLink: () => n.symlink });
  const get = path => { if (io.errors?.[path]) throw Object.assign(Error("Synthetic refusal"), { code: io.errors[path] }); const node = nodes.get(path); if (!node) throw Object.assign(Error("Synthetic absence"), { code: "ENOENT" }); return node; };
  const io = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072 },
    lstatSync(path) { calls.push(["lstat", path]); return stat(get(path)); },
    realpathSync(path) { return io.alias?.[path] ?? path; },
    openSync(path, flags) { assert.equal(flags, 131072); calls.push(["open", path]); const node = get(path); if (node.symlink) throw Object.assign(Error("Synthetic nofollow"), { code: "ELOOP" }); const fd = next++; fds.set(fd, { path, node, offset: 0 }); return fd; },
    fstatSync(fd) { return stat(fds.get(fd).node); },
    readSync(fd, output, offset, length) { const f = fds.get(fd); if (io.readError) throw Object.assign(Error("Synthetic read refusal"), { code: io.readError }); const count = Math.min(3, length, f.node.bytes.length - f.offset); f.node.bytes.copy(output, offset, f.offset, f.offset + count); f.offset += count; if (io.onRead) io.onRead(f, nodes); return count; },
    closeSync(fd) { calls.push(["close", fd]); assert.equal(fds.delete(fd), true); },
  };
  return { io, nodes, fds, calls };
}
const v2 = { [paths[0]]: "15032385536\n", [paths[1]]: "11259904\n" };
const v1 = { [paths[2]]: "15032385536\n", [paths[3]]: "11259904\n" };
const refuses = f => { assert.throws(() => readNativeFinalMemory(f.io)); assert.equal(f.fds.size, 0); };

test("v2 exact fixed pair retains safe number shape and closes descriptors", () => {
  const f = fixture(v2); assert.deepEqual(readNativeFinalMemory(f.io), { limit: 14 * GB, used: 11259904 }); assert.equal(f.fds.size, 0); assert.ok(!f.calls.some(c => paths.slice(2).includes(c[1])));
});
test("both v2 ENOENT permits exact observed v1 pair, no invented memory", () => {
  const f = fixture(v1); assert.deepEqual(readNativeFinalMemory(f.io), { limit: 15032385536, used: 11259904 }); assert.equal(f.fds.size, 0); assert.equal(f.calls.filter(c => c[0] === "open").length, 2);
});
test("present v2 remains authoritative even when v1 has different values", () => {
  const f = fixture({ ...v2, [paths[2]]: "4294967296\n", [paths[3]]: "0\n" }); assert.equal(readNativeFinalMemory(f.io).limit, 14 * GB); assert.ok(!f.calls.some(c => paths.slice(2).includes(c[1])));
});
for (const present of [0, 1]) test(`partial v2 pair ${present} refuses rather than v1 fallback`, () => {
  const f = fixture({ [paths[present]]: v2[paths[present]], ...v1 }); refuses(f); assert.ok(!f.calls.some(c => paths.slice(2).includes(c[1])));
});
for (const code of ["EACCES", "ELOOP", "EPERM", "EIO"]) test(`v2 ${code} is not absence or fallback`, () => {
  const f = fixture(v1); f.io.errors = { [paths[0]]: code }; refuses(f); assert.ok(!f.calls.some(c => paths.slice(2).includes(c[1])));
});
for (const value of ["max\n", "nope\n", "-1\n", "1.5\n", "9007199254740992\n", "9223372036854771712\n", "1".repeat(129), Buffer.from([0xb1, 0x0a])]) test(`unsupported memory bytes ${Buffer.from(value).toString("hex").slice(0, 32)} refuse without fallback`, () => {
  const f = fixture({ ...v2, [paths[0]]: value, ...v1 }); refuses(f); assert.ok(!f.calls.some(c => paths.slice(2).includes(c[1])));
});
test("128-byte bounded numeric padding accepted; 129-byte input refused", () => {
  const f = fixture({ ...v2, [paths[0]]: "15032385536" + " ".repeat(117) }); assert.equal(readNativeFinalMemory(f.io).limit, 14 * GB); assert.equal(f.fds.size, 0); refuses(fixture({ ...v2, [paths[0]]: "15032385536" + " ".repeat(118) }));
});
for (const missing of [2, 3]) test(`missing v1 field ${missing} refuses after legitimate v2 absence`, () => { const f = fixture({ ...v1 }); f.nodes.delete(paths[missing]); refuses(f); });
test("v1 invalid or unlimited sentinel remains a refusal", () => { refuses(fixture({ ...v1, [paths[2]]: "9223372036854771712\n" })); refuses(fixture({ ...v1, [paths[3]]: "max\n" })); });
test("symlink and aliased memory paths refuse", () => { const f = fixture(v2); f.nodes.get(paths[0]).symlink = true; refuses(f); const a = fixture(v2); a.io.alias = { [paths[0]]: "/foreign" }; refuses(a); });
for (const field of ["ino", "dev", "mtimeMs", "ctimeMs", "mode", "uid", "size"]) test(`changed memory ${field} identity closes descriptor and refuses`, () => {
  const f = fixture(v2); let changed = false; f.io.onRead = data => { if (!changed) { data.node[field]++; changed = true; } }; refuses(f);
});
test("path replacement and ENOENT during descriptor read cannot authorize fallback", () => {
  const f = fixture({ ...v2, ...v1 }); let changed = false; f.io.onRead = (data, nodes) => { if (!changed) { nodes.set(data.path, { ...data.node, ino: 999 }); changed = true; } }; refuses(f);
  const e = fixture({ ...v2, ...v1 }); e.io.readError = "ENOENT"; refuses(e); assert.ok(!e.calls.some(c => paths.slice(2).includes(c[1])));
});
test("existing constructor exact configured limit and >=2GiB headroom still refuse before native imports", async () => {
  const scriptNames = ["build-llvm-runtime.sh", "native-build-concurrency.mjs", "native-llvm-checkpoint.mjs", "fetch-runtime-vendor-sources.mjs", "runtime-vendor-sources.json", "check-llvm-package.mjs", "check-llvm-jit.c", "check-llvm-arm-defaults.cpp", "reconcile-llvm-arm-unit-fixture.mjs"];
  const finalLog = Buffer.from("synthetic retained log\n");
  const options = { verificationId: "a".repeat(64), scriptPins: Object.fromEntries(scriptNames.map(n => [n, "b".repeat(64)])), probePins: { "llvm-arm-policy": "c".repeat(64), "llvm-cpu-jit": "d".repeat(64) }, finalLog, finalLogSha256: createHash("sha256").update(finalLog).digest("hex"), deadlineMs: 1000, cleanupDeadlineMs: 1100, memoryLimitBytes: 14 * GB, exclusiveWriter: true };
  for (const memory of [{ limit: 12 * GB, used: 0 }, { limit: 14 * GB, used: 13 * GB }, { limit: 14 * GB, used: 15 * GB }]) {
    let nativeCalls = 0; const f = fixture({ [paths[2]]: String(memory.limit), [paths[3]]: String(memory.used) });
    await assert.rejects(createNativeFreshFinalAdapter(options, { fs: f.io, exec: () => { nativeCalls++; throw Error("Forbidden"); }, importExact: () => { nativeCalls++; throw Error("Forbidden"); }, clock: () => 1, platform: () => "linux", uid: () => 0, memory: () => readNativeFinalMemory(f.io) }));
    assert.equal(nativeCalls, 0); assert.equal(f.fds.size, 0);
  }
});
